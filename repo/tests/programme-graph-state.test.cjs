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

function fixture(numbers = [2], pinned = []) {
  const github = new FakeGitHub({ repository: 'example.test/app', store: 'example.test/store' });
  const binding = { schema: state.SCHEMA.binding, repository: github.repository, parent_issue: 1, record_prefix: 'TEST-', writer_prefix: 'TEST-',
    store: { kind: 'github', repository: github.storeRepository, branch: 'main', path: 'state/' }, required_checks: ['validate'] };
  const outcomes = numbers.map((issue, i) => ({ issue, label: `Task ${issue}`, class: 'COMMITTED', parent: 1, order: i + 1, ...(pinned.includes(issue) ? { last: true } : {}) }));
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

test('fix1 H1: 226 parent cross-references never gate task history or finding resolution',()=>{
  const f=fixture([2,3]); pr(f,20,{body:'Refs #3'}); f.run();
  f.github.issuePrLinks.set(1,{timeline:Array.from({length:226},(_,i)=>100+i),timelineTruncated:true});
  f.github.prs.get(20).body='Refs #1'; pr(f,21,{body:'Refs #2'});
  const pass=f.pass(); const plan=pass.plan(); assert.equal(plan.observed.prGraph.complete,true);
  assert.equal(plan.complete,true); pass.apply(plan);
  assert.deepEqual(f.child(2).prs,[{number:21,state:'OPEN',merge_sha:null}]);
  assert.equal(f.parent().attention.find(e=>e.code==='PR_UNTRACKED' && e.issue===3).state,'resolved');
  assert.ok(!openCodes(f).includes('PR_DISCOVERY_INCOMPLETE'));
  assert.ok(!f.parent().attention.some(e=>e.code==='PR_WITHOUT_TASK' && e.issue===20));
});

test('fix1 H1: a task reference gap holds only its discovery findings',()=>{
  const f=fixture([2,3]); pr(f,20,{body:'Refs #3'}); f.run();
  f.github.issuePrLinks.set(2,{timelineTruncated:true}); f.github.prs.get(20).body='';
  const report=f.run();
  assert.deepEqual(report.findings.filter(e=>e.code==='PR_DISCOVERY_INCOMPLETE').map(e=>e.issue),[2]);
  assert.equal(f.parent().attention.find(e=>e.code==='PR_UNTRACKED' && e.issue===3).state,'resolved');
  assert.deepEqual(f.child(3).prs,[]);
});

test('fix1 H1: a closed-list failure still settles findings proved by the complete open list',()=>{
  const f=fixture(); pr(f,20,{body:'Refs #2'}); f.run(); f.github.prs.get(20).body='Refs #1';
  f.github.intercept(call=>call.method==='GET' && /pulls\?state=closed/.test(call.path) ? {status:503,json:{}} : null);
  f.run(); assert.ok(openCodes(f).includes('PR_DISCOVERY_INCOMPLETE'));
  assert.equal(f.parent().attention.find(e=>e.code==='PR_UNTRACKED' && e.issue===2).state,'resolved');
});

test('fix1 H2: 520 historic unlinked merges seed without findings; a later merge raises one',()=>{
  const f=fixture();
  for(let n=100;n<620;n++) pr(f,n,{merged:true,mergedAt:'2026-11-01T00:00:00Z'});
  assert.deepEqual(f.run().holds,[]); assert.ok(f.parent().private.graph_pr_watermark);
  assert.deepEqual(openCodes(f),[]);
  pr(f,700,{merged:true,mergedAt:'2026-11-08T01:00:00Z'}); f.time(epoch+2*3600000);
  assert.deepEqual(f.run().holds,[]);
  assert.deepEqual(f.parent().attention.filter(e=>e.code==='PR_WITHOUT_TASK').map(e=>e.issue),[700]);
});

test('fix1 M1: reconcile apply holds all three acknowledged refresh-owned findings',()=>{
  const f=fixture([2,3]); f.run(); f.close(2);
  f.store.mutate('child',3,{writer:holder,parentDoc:f.parent(),change:doc=>({...doc,lifecycle:'RETIRED'})});
  pr(f,20); f.run();
  const codes=['CLOSED_WITHOUT_ACCEPTANCE','CHILD_STATE_CONFLICT','PR_WITHOUT_TASK'];
  assert.deepEqual(openCodes(f),codes.slice().sort());
  for(const entry of f.parent().attention.filter(e=>codes.includes(e.code))) {
    f.store.mutate('parent',1,{writer:holder,change:doc=>state.answerFinding(doc,{next: 'Fixture next step', due:new Date(epoch+72*3600000).toISOString(), id:entry.id,state:'acknowledged',now:new Date(epoch).toISOString()})});
  }
  const before=f.parent().attention.filter(e=>codes.includes(e.code));
  f.time(epoch+25*3600000); f.pass(false).run({apply:true});
  assert.deepEqual(f.parent().attention.filter(e=>codes.includes(e.code)),before);
  f.run(); assert.deepEqual(f.parent().attention.filter(e=>codes.includes(e.code)),before);
  assert.doesNotMatch(state.attentionLine(f.parent().attention,new Date(epoch+25*3600000).toISOString()),/waiting on you/);
  // Past the promised time the acknowledgement no longer silences them: new again, and waiting at once.
  assert.match(state.attentionLine(f.parent().attention,new Date(epoch+73*3600000).toISOString()),/3 waiting on you/);
  f.time(epoch+73*3600000); f.run();
  assert.deepEqual(f.parent().attention.filter(e=>codes.includes(e.code)).map(e=>e.state),['new','new','new']);
});

test('fix1 M1 M2: a controller-close conflict stays acknowledged through ordinary reconciliation',()=>{
  const f=fixture(); f.store.mutate('child',2,{writer:holder,parentDoc:f.parent(),change:doc=>({...doc,lifecycle:'RETIRED'})});
  f.close(2); f.run();
  const entry=(f.parent().attention || []).find(e=>e.code==='CHILD_STATE_CONFLICT'); assert.ok(entry);
  f.store.mutate('parent',1,{writer:holder,change:doc=>state.answerFinding(doc,{next: 'Fixture next step', id:entry.id,state:'acknowledged',now:new Date(epoch).toISOString()})});
  f.pass(false).run({apply:true});
  assert.equal(f.parent().attention.find(e=>e.id===entry.id).state,'acknowledged');
  f.run(); assert.equal(f.parent().attention.find(e=>e.id===entry.id).state,'acknowledged');
});

test('fix1 M3: a seeded scan stops at its overlap before 1000 old closed PRs',()=>{
  const f=fixture(); f.run();
  for(let n=100;n<1100;n++) pr(f,n,{merged:true,mergedAt:'2026-11-01T00:00:00Z'});
  pr(f,20,{merged:true,mergedAt:'2026-11-08T01:00:00Z'}); // Old PR number, new update.
  f.time(epoch+2*3600000); f.github.calls=[];
  const pass=f.pass(); const plan=pass.plan(); assert.equal(plan.complete,true); pass.apply(plan);
  assert.equal(f.github.calls.filter(c=>/pulls\?state=closed/.test(c.path)).length,1);
  assert.deepEqual(f.parent().attention.filter(e=>e.code==='PR_WITHOUT_TASK').map(e=>e.issue),[20]);
});

test('fix1 M3: the overlap reads the next page for updates within five minutes of the watermark',()=>{
  const f=fixture(); f.run();
  for(let n=100;n<200;n++) { pr(f,n,{merged:true,mergedAt:'2026-11-07T23:58:00Z'}); }
  pr(f,20,{merged:true,mergedAt:'2026-11-01T00:00:00Z'});
  f.github.calls=[]; const plan=f.pass().plan(); assert.equal(plan.complete,true);
  assert.equal(f.github.calls.filter(c=>/pulls\?state=closed/.test(c.path)).length,2);
});

test('fix1 M3 control: incremental scans retain historical PR order and observe reopens',()=>{
  const f=fixture();
  pr(f,20,{merged:true,mergedAt:'2026-11-07T00:00:00Z',body:'Refs #2'});
  pr(f,21,{merged:true,mergedAt:'2026-11-06T00:00:00Z',body:'Refs #2'});
  pr(f,22,{state:'CLOSED',body:'Refs #2'}); f.run();
  assert.deepEqual(f.child(2).prs.map(p=>p.number),[20,21,22]);
  f.time(epoch+3600000); f.run();
  assert.deepEqual(f.child(2).prs.map(p=>p.number),[20,21,22]);
  Object.assign(f.github.prs.get(22),{state:'OPEN',updated_at:'2026-11-08T02:00:00Z'});
  f.time(epoch+3*3600000); f.run();
  assert.deepEqual(f.child(2).prs.map(p=>[p.number,p.state]),[[22,'OPEN'],[20,'MERGED'],[21,'MERGED']]);
});

test('fix1 M4: untracked findings use open PRs only, while history keeps closed PRs',()=>{
  const f=fixture([2,3,4]); pr(f,20,{merged:true,body:'Refs #2'});
  pr(f,21,{state:'CLOSED',body:'Refs #3'}); pr(f,22,{body:'Refs #4'});
  const report=f.run();
  assert.deepEqual(report.findings.filter(e=>e.code==='PR_UNTRACKED').map(e=>e.issue),[4]);
  assert.equal(f.child(2).prs[0].state,'MERGED'); assert.equal(f.child(3).prs[0].state,'CLOSED');
});

test('fix1 L1: recovery names the parent error as an update-Toolkit case',()=>{
  const skill=fs.readFileSync(path.join(ROOT,'skills/github-program-reconciler/SKILL.md'),'utf8');
  const changelog=fs.readFileSync(path.join(ROOT,'repo/docs/CHANGELOG.md'),'utf8').split('## 3.55.1')[0];
  for(const text of [skill,changelog]) assert.match(text,/attention\[n\]\.code is not a known finding code/);
});

test('fix1 L5: documentation puts native sub-issue observations outside the PR budget',()=>{
  const skill=fs.readFileSync(path.join(ROOT,'skills/github-program-reconciler/SKILL.md'),'utf8');
  assert.match(skill,/sub-issue.*outside.*(?:sixty|60)/i);
});

test('fix1 L2: skip children of a catalogued registered parent and still adopt unrelated tasks',()=>{
  const f=fixture([2,10]);
  Object.assign(f.binding,{schema:state.SCHEMA.bindingV2,governance:'enabled',parents:[{issue:1,record_prefix:'TEST-'},{issue:10,record_prefix:'OTHER-'}]});
  f.github.addIssue(11,{parent:10}); f.github.addIssue(12,{parent:1});
  const pass=f.pass(); const plan=pass.plan();
  assert.deepEqual(plan.observed.additions.map(o=>o.issue),[12]);
  assert.ok(!plan.findings.some(e=>e.code==='CHILD_ADDED'));
  assert.deepEqual(pass.apply(plan).holds,[]);
  assert.ok(!f.parent().outcomes.some(o=>o.issue===11)); assert.ok(f.parent().outcomes.some(o=>o.issue===12));
  assert.deepEqual(f.parent().attention.filter(e=>e.code==='CHILD_ADDED').map(e=>e.issue),[12]);
});

test('a task the sweep adds later lands before the task pinned last in its band, in the catalogue order and natively',()=>{
  const f=fixture([2,3],[3]);
  const lifecycle=value=>f.store.mutate('child',3,{writer:holder,parentDoc:f.parent(),change:doc=>({...doc,lifecycle:value})});
  lifecycle('PLANNED'); f.run();
  assert.deepEqual(f.github.issues.get(1).subs,[2,3]);
  f.github.addIssue(4,{parent:1}); f.github.addIssue(5,{parent:1});
  f.run(); f.run();
  const added=f.parent().outcomes.filter(o=>[4,5].includes(o.issue));
  assert.deepEqual(added.map(o=>[o.issue,o.order,o.last]),[[4,3,undefined],[5,4,undefined]],'additions take the next order and are never pinned');
  assert.equal(f.parent().outcomes.find(o=>o.issue===3).last,true,'the pin survives the sweep');
  assert.deepEqual(f.github.issues.get(1).subs,[2,4,5,3],'native sub-issues follow, with the pinned task last');
  lifecycle('ACTIVE'); f.run();
  assert.deepEqual(f.github.issues.get(1).subs,[2,3,4,5],'a pinned task in progress ends its NOW band, never below LATER');
});

test('fix1 L2: failed adoption never records CHILD_ADDED',()=>{
  const f=fixture(); f.github.addIssue(3,{parent:1}); const pass=f.pass(); const plan=pass.plan();
  f.github.issues.get(3).parent=null;
  assert.ok(pass.apply(plan).holds.some(e=>e.code==='GRAPH_FACT_STALE'));
  assert.ok(!f.parent().outcomes.some(o=>o.issue===3));
  assert.ok(!(f.parent().attention || []).some(e=>e.code==='CHILD_ADDED'));
  assert.ok(!plan.findings.some(e=>e.code==='CHILD_ADDED'));
});

test('fix1 L3: watermark uses scan start, so a close during the scan is seen next pass',()=>{
  const f=fixture(); const pass=f.pass(); const scan=pass.reader.graphPullRequests.bind(pass.reader);
  pass.reader.graphPullRequests=(...args)=>{const rows=scan(...args); f.time(epoch+3600000); return rows;};
  const plan=pass.plan(); pass.apply(plan);
  assert.equal(f.parent().private.graph_pr_watermark,new Date(epoch).toISOString());
  pr(f,20,{merged:true,mergedAt:'2026-11-08T00:30:00Z'}); f.time(epoch+2*3600000); f.run();
  assert.ok(openCodes(f).includes('PR_WITHOUT_TASK'));
});

test('fix1 L4: a failed watermark write is held, with other effects retained and retried',()=>{
  const f=fixture(); const pass=f.pass(); const plan=pass.plan(); const mutate=f.store.mutate.bind(f.store);
  // Detect the watermark change before the mutating callback edits its argument.
  f.store.mutate=(kind,number,options)=>mutate(kind,number,{...options,change:(doc,context)=>{
    const before=doc.private?.graph_pr_watermark; const next=options.change(doc,context);
    if(next?.private?.graph_pr_watermark && !before) throw new Error('fixture watermark write failure');
    return next;
  }});
  const result=pass.apply(plan);
  assert.ok(result.holds.some(e=>e.code==='STATE_WRITE_FAILED'));
  assert.ok(result.results.some(e=>e.kind==='advance_pr_watermark' && e.outcome==='HELD'));
  assert.ok(f.github.issues.get(2).body.includes('STATE')); assert.ok(!f.parent().private?.graph_pr_watermark);
  f.store.mutate=mutate; assert.deepEqual(f.run().holds,[]); assert.ok(f.parent().private.graph_pr_watermark);
});

test('fix1 L7: owner-authored shard timing branches are excluded with a narrow prefix',()=>{
  const f=fixture(); pr(f,20,{branch:'toolkit/shard-timings-abcdef0'});
  pr(f,21,{branch:'toolkit/shard-timing-abcdef0'}); pr(f,22,{branch:'feature/toolkit/shard-timings-abcdef0'});
  f.run(); assert.deepEqual(f.parent().attention.filter(e=>e.code==='PR_WITHOUT_TASK').map(e=>e.issue).sort((a,b)=>a-b),[21,22]);
});

test('fix1 H1: parent and task title references count without reading the parent timeline',()=>{
  const f=fixture(); pr(f,20); f.github.prs.get(20).title='Fixes #1';
  pr(f,21); f.github.prs.get(21).title='Refs #2';
  f.run(); assert.ok(!openCodes(f).includes('PR_WITHOUT_TASK'));
  assert.deepEqual(f.child(2).prs,[{number:21,state:'OPEN',merge_sha:null}],'the PR title is never saved in state');
  assert.match(f.github.issues.get(2).body,/^\|`Refs #2`\|#21\|OPEN\|-\|$/m,'the task page shows it as code');
});

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
  assert.match(f.github.issues.get(1).body,/\n\[Retired \(2\)\]\(https:[^)]+\)\n/,'the retired rows (#3 and the nested #6) sit behind one link');
  assert.ok(f.github.commentsOf(1).some(comment => /^\|[^|\n]*\|#3\|RETIRED\|/m.test(comment.body)),'its row is in the archive comment');
  assert.doesNotMatch(state.findStateBlock(f.github.issues.get(1).body).block.body,/#20|aaaaaaa/);
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
  pr(f,22,{state:'CLOSED'}); pr(f,24,{merged:true});
  pr(f,25); pr(f,26,{body:'Refs #1'}); pr(f,27); pr(f,28);
  f.github.prs.get(24).author='dependabot[bot]'; f.github.prs.get(27).author='github-actions[bot]'; f.github.prs.get(28).author='app/github-actions';
  f.github.issuePrLinks.set(2,{closing:[21],timeline:[22]});
  f.run(); // Seed historic closes while discovering the original task history.
  pr(f,23,{merged:true,mergedAt:'2026-11-08T01:00:00Z'});
  assert.deepEqual(f.run().holds,[]);
  assert.deepEqual(f.child(2).prs.map(p => p.number),[21,20,22]);
  assert.deepEqual(f.parent().attention.filter(e => e.code === 'PR_WITHOUT_TASK').map(e => e.issue).sort((a,b)=>a-b),[23,25]);
  const finding = f.parent().attention.find(e => e.issue===23);
  f.store.mutate('parent',1,{writer:holder,change:doc => state.answerFinding(doc,{next: 'Fixture next step', id:finding.id,state:'disposed',reason:'Owner confirmed standalone maintenance',now:new Date(epoch).toISOString()})});
  f.run(); assert.equal(f.parent().attention.find(e=>e.id===finding.id).state,'disposed');
});

test('A2-5: 24-hour waiting threshold redraws only changed text; acknowledgement removes waiting', () => {
  const f = fixture(); f.close(2); f.run();
  f.time(epoch + 24*3600000 - 60000); f.run();
  assert.doesNotMatch(f.github.issues.get(1).body,/Waiting on you|waiting on you/);
  f.time(epoch+24*3600000); f.run();
  assert.match(state.attentionLine(f.parent().attention,new Date(epoch+24*3600000).toISOString()),/1 waiting on you/);
  assert.match(f.github.issues.get(1).body,/1 waiting on you\*\*/);
  const count = writes(f); f.time(epoch+25*3600000); f.run(); assert.equal(writes(f),count);
  const id=f.parent().attention[0].id;
  f.store.mutate('parent',1,{writer:holder,change:doc=>state.answerFinding(doc,{next: 'Fixture next step', id,state:'acknowledged',now:new Date(epoch+25*3600000).toISOString()})});
  f.run(); assert.doesNotMatch(f.github.issues.get(1).body,/waiting on you/);
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

// Acceptance logged with no gate lifecycle: the review and UAT the controller records. With a PR head
// tracked, the verdicts and head-bound UAT must speak for that head; with none, the newest verdict counts.
{
  const OLD='b'.repeat(40);
  const v=(verdict,head=SHA)=>({reviewer:'G2 fixture',head,verdict});
  for (const [label,tracked,review,uat,raised] of [
    ['PASSED at the head, UAT NOT_REQUIRED',true,['PASSED',[v('PASSED')]],['NOT_REQUIRED',null],false],
    ['PASSED at the head, UAT PASSED at it',true,['PASSED',[v('PASSED')]],['PASSED',SHA],false],
    ['PASSED at the head, UAT retained at it',true,['PASSED',[v('PASSED')]],['UAT_RETAINED',SHA],false],
    ['PASSED at the head, UAT at an older head',true,['PASSED',[v('PASSED')]],['PASSED',OLD],true],
    ['PASSED at the head, UAT unrecorded',true,['PASSED',[v('PASSED')]],[null,null],true],
    ['PASSED at the head, UAT owed',true,['PASSED',[v('PASSED')]],['PENDING',null],true],
    ['PASSED at an older head only',true,['PASSED',[v('PASSED',OLD)]],['NOT_REQUIRED',null],true],
    ['a NOT_PASSED verdict at the head',true,['PASSED',[v('PASSED'),v('NOT_PASSED')]],['NOT_REQUIRED',null],true],
    ['review NOT_PASSED',true,['NOT_PASSED',[v('NOT_PASSED')]],['NOT_REQUIRED',null],true],
    ['no review',true,[null,[]],['NOT_REQUIRED',null],true],
    ['no head tracked, newest verdict PASSED',false,['PASSED',[v('NOT_PASSED',OLD),v('PASSED')]],['PASSED',OLD],false],
    ['no head tracked, newest verdict NOT_PASSED',false,['PASSED',[v('PASSED'),v('NOT_PASSED',OLD)]],['NOT_REQUIRED',null],true],
  ]) test(`logged acceptance matrix: ${label} ${raised?'still raises':'raises no'} closed-without-acceptance`,()=>{
    const f=fixture(); if(tracked) pr(f,20,{merged:true,body:'Closes #2'});
    f.store.mutate('child',2,{writer:holder,parentDoc:f.parent(),change:doc=>({...doc,...(tracked?{pr:{...doc.pr,number:20}}:{}),
      review:{state:review[0],verdicts:review[1]},uat:{state:uat[0],at_head:uat[1]}})});
    f.close(2); f.run();
    assert.equal(f.child(2).lifecycle,'DONE'); assert.equal(f.child(2).gate.role,null);
    assert.equal(f.child(2).pr.head,tracked?SHA:null);
    assert.equal(openCodes(f).includes('CLOSED_WITHOUT_ACCEPTANCE'),raised);
  });
}

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

// Task #2 tracks PR 22, in the given state; the rest of its PR history is set per test.
const tracking = (prState = 'CLOSED', numbers = [2]) => {
  const f=fixture(numbers);
  pr(f,22,prState==='MERGED' ? {merged:true,mergedAt:'2026-11-06T00:00:00Z',body:'Refs #2'} : {state:prState,body:'Refs #2'});
  f.store.mutate('child',2,{writer:holder,parentDoc:f.parent(),change:doc=>({...doc,pr:{...doc.pr,number:22}})});
  return f;
};
const NEW = 'b'.repeat(40);
const tracked = (f, n = 2) => [f.child(n).pr.number, f.child(n).pr.state];
const merged = (at, body = 'Refs #2', options = {}) => ({merged:true,mergedAt:at,body,...options});
const closeListed = (report, n = 2) => report.close_list.filter(entry=>entry.issue===n).map(entry=>entry.pr);

test('superseded T1: a closed tracked PR gives way to the newest newer merged PR that claims the task',()=>{
  const f=tracking();
  pr(f,25,merged('2026-11-07T00:00:00Z','Refs #2',{head:NEW})); pr(f,24,merged('2026-11-06T00:00:00Z'));
  f.run();
  assert.deepEqual([...tracked(f),f.child(2).pr.head],[25,'MERGED',NEW]);
  assert.deepEqual(f.child(2).prs.map(p=>p.number),[25,24,22]);
  assert.ok(!openCodes(f).includes('PR_DISCOVERY_INCOMPLETE'));
});

test('superseded T2: a closed tracked PR gives way to the one newer open claimant before any merged one',()=>{
  const f=tracking();
  pr(f,20,merged('2026-11-07T00:00:00Z')); pr(f,23,{head:NEW,body:'Refs #2'});
  // PR 23 is both a body reference and a timeline link, and still counts as one open PR.
  f.github.issuePrLinks.set(2,{timeline:[23]});
  f.run();
  assert.deepEqual([...tracked(f),f.child(2).pr.head],[23,'OPEN',NEW]);
});

test('superseded T3: two newer open claimants are ambiguous, so the closed tracked PR stays tracked',()=>{
  const f=tracking(); pr(f,23,{body:'Refs #2'}); pr(f,24,{body:'Refs #2'});
  f.run();
  assert.deepEqual(tracked(f),[22,'CLOSED']);
  assert.ok(!openCodes(f).includes('PR_DISCOVERY_INCOMPLETE'));
});

test('superseded T4: a replacement read that fails or disagrees with the lists keeps the tracked PR and leaves discovery incomplete',()=>{
  // [replacement PR, its list entry, what its own read does]
  for(const [number,listed,answer] of [[25,merged('2026-11-07T00:00:00Z'),'closed'],[25,merged('2026-11-07T00:00:00Z'),'fails'],[23,{body:'Refs #2'},'merged']]) {
    const f=tracking(); pr(f,number,listed);
    let read=false;
    f.github.intercept(call=>{
      if(read || call.path!=='graphql' || !/pullRequest\(number: \$number\)/.test(call.body.query) || call.body.variables?.number!==number) return null;
      read=true;
      if(answer==='fails') throw new state.ProgrammeError('GH_FAILED','The PR read failed.');
      Object.assign(f.github.prs.get(number),answer==='closed' ? {merged:false,state:'CLOSED'} : {merged:true,mergedAt:'2026-11-07T00:00:00Z'});
      return null;
    });
    const report=f.run();
    assert.deepEqual(report.findings.filter(e=>e.code==='PR_DISCOVERY_INCOMPLETE').map(e=>e.issue),[2],`${number} ${answer}`);
    assert.deepEqual(tracked(f),[22,'CLOSED'],`${number} ${answer}`);
  }
});

test('superseded T5: a merged PR that only mentions the task never replaces its tracked PR',()=>{
  const f=tracking(); pr(f,30,merged('2026-11-07T00:00:00Z','Touches the code that #2 also changes.'));
  f.github.issuePrLinks.set(2,{timeline:[30]});
  const report=f.run();
  assert.deepEqual(tracked(f),[22,'CLOSED']);
  assert.deepEqual(closeListed(report),[]);
});

test('superseded T6: another task\'s open PR that mentions the task never replaces it, and gets no rows for it',()=>{
  const f=tracking('CLOSED',[2,3]); pr(f,31,{body:'Closes #3. It also touches what #2 changes.'});
  f.github.issuePrLinks.set(2,{timeline:[31]});
  f.run();
  assert.deepEqual(tracked(f),[22,'CLOSED']);
  const body=f.github.prs.get(31).body;
  assert.ok(!body.includes('> #2 >') && !/^#2:/m.test(body),'PR 31 carries only task #3\'s rows');
});

test('superseded T7: a newer open PR in the task\'s closing links claims it without a keyword',()=>{
  const f=tracking(); pr(f,23,{head:NEW,body:'A rebuild.'});
  f.github.issuePrLinks.set(2,{closing:[23]});
  f.run();
  assert.deepEqual(tracked(f),[23,'OPEN']);
});

test('superseded T8: a merged PR known only from the saved history never replaces the tracked PR',()=>{
  const f=tracking(); pr(f,25,merged('2026-11-07T00:00:00Z','Unrelated.'));
  f.store.mutate('child',2,{writer:holder,parentDoc:f.parent(),change:doc=>({...doc,prs:[{number:25,state:'MERGED',merge_sha:SHA},{number:22,state:'CLOSED',merge_sha:null}]})});
  f.run();
  assert.deepEqual(tracked(f),[22,'CLOSED']);
});

test('superseded T9: an older merged claimant is no fallback, so a replacement opened later is still followed',()=>{
  const f=fixture(); pr(f,19,merged('2026-11-06T00:00:00Z')); pr(f,22,{body:'Refs #2'});
  f.store.mutate('child',2,{writer:holder,parentDoc:f.parent(),change:doc=>({...doc,pr:{...doc.pr,number:22}})});
  f.github.prs.get(22).state='CLOSED';
  const report=f.run();
  assert.deepEqual(tracked(f),[22,'CLOSED']);
  assert.deepEqual(closeListed(report),[]);
  pr(f,23,{body:'Closes #2'});
  f.run(); assert.deepEqual(tracked(f),[23,'OPEN']);
  f.run(); assert.deepEqual(tracked(f),[23,'OPEN']);
});

test('superseded T10: an open leftover PR is followed until it merges, then the open replacement',()=>{
  const f=tracking(); const seen=[];
  pr(f,24,{body:'Refs #2'}); f.run(); seen.push(tracked(f));
  pr(f,25,{body:'Closes #2'}); f.run(); seen.push(tracked(f));
  Object.assign(f.github.prs.get(24),{merged:true,mergedAt:'2026-11-07T12:00:00Z'}); f.run(); seen.push(tracked(f));
  assert.deepEqual(seen,[[24,'OPEN'],[24,'OPEN'],[25,'OPEN']]);
});

test('superseded T11: a merged tracked PR on an open task gives way only to exactly one newer open claimant',()=>{
  for(const [others,want] of [[[[23,{body:'Refs #2'}]],[23,'OPEN']],[[[21,{body:'Refs #2'}]],[22,'MERGED']],
    [[[23,{body:'Refs #2'}],[24,{body:'Refs #2'}]],[22,'MERGED']],[[[23,merged('2026-11-07T00:00:00Z')]],[22,'MERGED']]]) {
    const f=tracking('MERGED'); for(const [n,options] of others) pr(f,n,options);
    f.run();
    assert.deepEqual(tracked(f),want,JSON.stringify(others.map(([n])=>n)));
  }
});

test('superseded T12: a task closed as completed this pass moves from a closed PR only to a newer merged claimant',()=>{
  for(const [options,want] of [[merged('2026-11-07T00:00:00Z'),[23,'MERGED']],[{body:'Refs #2'},[22,'CLOSED']]]) {
    const f=tracking(); pr(f,23,options); f.close(2);
    f.run();
    assert.equal(f.child(2).lifecycle,'DONE');
    assert.deepEqual(tracked(f),want);
  }
});

test('superseded T13: a retired task never moves',()=>{
  const f=tracking(); pr(f,23,merged('2026-11-07T00:00:00Z')); f.close(2,'not_planned');
  f.run();
  assert.equal(f.child(2).lifecycle,'RETIRED');
  assert.deepEqual(tracked(f),[22,'CLOSED']);
});

test('superseded T14: an older claimant never replaces the tracked PR',()=>{
  const f=tracking(); pr(f,20,merged('2026-11-07T00:00:00Z'));
  f.run();
  assert.deepEqual(tracked(f),[22,'CLOSED']);
});

test('superseded T15: a newer claimant that also closed unmerged is no replacement, and discovery stays complete',()=>{
  const f=tracking(); pr(f,23,{state:'CLOSED',body:'Refs #2'});
  f.run();
  assert.deepEqual(tracked(f),[22,'CLOSED']);
  assert.ok(!openCodes(f).includes('PR_DISCOVERY_INCOMPLETE'));
});

test('superseded T16: the replacement read spends from the discovery budget',()=>{
  const f=tracking(); pr(f,25,merged('2026-11-07T00:00:00Z'));
  const pass=f.pass(); const links=pass.reader.issuePullRequestLinks.bind(pass.reader);
  // Use up the rest of the budget after the link read, so the replacement read is the first past it.
  pass.reader.issuePullRequestLinks=(numbers,spend)=>{ const result=links(numbers,spend); try { for(;;) spend(); } catch { /* budget used up */ } return result; };
  const report=pass.run({apply:true});
  assert.deepEqual(report.findings.filter(e=>e.code==='PR_DISCOVERY_INCOMPLETE').map(e=>e.issue),[2]);
  assert.deepEqual(tracked(f),[22,'CLOSED']);
});

test('superseded T17: a merge train is never the replacement; the member it carried is',()=>{
  const f=tracking(); pr(f,23,merged('2026-11-07T00:00:00Z'));
  pr(f,26,merged('2026-11-07T00:00:00Z',trainBody([23],[2])));
  f.github.issuePrLinks.set(2,{timeline:[26]});
  f.run();
  assert.deepEqual(tracked(f),[23,'MERGED']);
});

test('superseded T18: the planned effect names the move, in its text and in the JSON report',()=>{
  const f=tracking(); pr(f,25,merged('2026-11-07T00:00:00Z')); pr(f,24,merged('2026-11-06T00:00:00Z'));
  const plan=f.pass().plan();
  const effect=plan.effects.find(e=>e.kind==='update_state' && e.target.issue===2);
  assert.deepEqual(effect.replacement,{from:22,from_state:'CLOSED',selected:25,selected_state:'MERGED'});
  assert.match(effect.text,/follow merged PR #25 in place of closed unmerged PR #22/);
  const report=f.pass().run({apply:false});
  assert.deepEqual(report.effects.find(e=>e.kind==='update_state' && e.target.issue===2).replacement.selected,25);
});

// An owed UAT names the PR it was recorded on (its head), not whichever PR the task tracks now.
const UAT_HEAD = 'c'.repeat(40);
const owedOn = (f, n = 2) => {
  const cells = f.github.issues.get(1).body.split('\n').find(line => line.startsWith(`|`) && line.includes(`|#${n}|`)).slice(1, -1).split('|');
  const current = f.github.issues.get(1).body.split('\n').find(line => line.startsWith(`- #${n} `));
  const prRows = f.github.issues.get(n).body.split('\n').filter(line => /^\|[^|]*\|#\d+\|/.test(line)).map(line => line.split('|').slice(2, 4).join(' '));
  const under = f.github.issues.get(n).body.split('\n').filter(line => line.startsWith('Task: '));
  return { waiting: cells[3], current, prRows, under };
};
const owing = (f, change = {}) => f.store.mutate('child',2,{writer:holder,parentDoc:f.parent(),change:doc=>({...doc,uat:{state:'UAT_PARTIAL_REQUIRED',at_head:UAT_HEAD},...change(doc)})});
// The owner's UAT step needs the agent's UAT first: these tests record the agent's PASS at the UAT's head.
const ownerOwing = (f, change = doc => ({})) => owing(f, doc => { const next = {uat:{state:'UAT_PARTIAL_REQUIRED',at_head:UAT_HEAD},...change(doc)};
  return {...next,private:{...(next.private || doc.private),agent_uat:{state:'PASSED',at_head:next.uat.at_head,evidence:'evidence/uat-2-agent/REPORT.md'}}}; });

test('owed UAT T1 (SQAG #334): a UAT owed at merged PR #374\'s head stays on #374 while open PR #357 is tracked',()=>{
  const f=fixture();
  pr(f,374,merged('2026-11-07T00:00:00Z','Refs #2',{head:UAT_HEAD})); pr(f,357,{head:NEW,body:'Refs #2'});
  ownerOwing(f, doc=>({pr:{...doc.pr,number:357}}));
  f.run();
  assert.deepEqual([...tracked(f),f.child(2).pr.head],[357,'OPEN',NEW]);
  assert.deepEqual(f.child(2).private.pr_heads,[{pr:357,head:NEW},{pr:374,head:UAT_HEAD}],'the refresh keeps the head of every task PR it read');
  const seen=owedOn(f);
  assert.equal(seen.waiting,'Owner: UAT on PR #374');
  assert.equal(seen.current,'- #2 Issue 2 · PR #357 · waiting on you: your UAT on PR #374');
  assert.deepEqual(seen.prRows,['#357 OPEN','#374 MERGED · Owner UAT owed'],'the task page puts the owed UAT on #374, not on the tracked #357');
  assert.deepEqual(seen.under,[]);
  const writesBefore=writes(f); f.run();
  assert.equal(writes(f),writesBefore,'a pass that sees no new head writes nothing');
});

test('owed UAT T2: a head no known PR has shows as the short head SHA, with no PR number',()=>{
  const f=fixture(); pr(f,357,{head:NEW,body:'Refs #2'});
  ownerOwing(f, doc=>({pr:{...doc.pr,number:357}}));
  f.run();
  const seen=owedOn(f);
  assert.equal(seen.waiting,'Owner: UAT at ccccccc');
  assert.equal(seen.current,'- #2 Issue 2 · PR #357 · waiting on you: your UAT at ccccccc');
  assert.deepEqual(seen.prRows,['#357 OPEN']);
  assert.deepEqual(seen.under,['Task: Owner UAT owed at ccccccc']);
});

test('owed UAT T3: with no replacement (the tracked PR is the UAT\'s PR) the pages read as before',()=>{
  const f=fixture(); pr(f,22,{head:UAT_HEAD,body:'Refs #2'});
  ownerOwing(f, doc=>({pr:{...doc.pr,number:22},gate:{...doc.gate,role:'G2',state:'ACTIVE'}}));
  f.run();
  const seen=owedOn(f);
  assert.equal(seen.waiting,'G2, then Owner: UAT on PR #22');
  assert.equal(seen.current,'- #2 Issue 2 · PR #22 · G2 · then your UAT on PR #22');
  assert.deepEqual(seen.prRows,['#22 OPEN · G2 ACTIVE · Owner UAT owed']);
  assert.deepEqual(seen.under,[]);
});

test('owed UAT T4: the sweep writes only its PR heads into private, and the stored task stays readable by older Toolkit copies',()=>{
  const f=fixture();
  pr(f,374,merged('2026-11-07T00:00:00Z','Refs #2',{head:UAT_HEAD})); pr(f,357,{head:NEW,body:'Refs #2'});
  owing(f, doc=>({pr:{...doc.pr,number:357}}));
  const pass=f.pass(); const plan=pass.plan();
  // The controller marks the task after the sweep planned: the apply keeps that mark.
  f.store.mutate('child',2,{writer:holder,parentDoc:f.parent(),change:doc=>({...doc,private:{...doc.private,keep_open:{reason:'Waiting for the follow-up'}}})});
  pass.apply(plan);
  const child=f.child(2);
  assert.equal(child.private.keep_open.reason,'Waiting for the follow-up');
  assert.equal(child.private.pr_heads.length,2);
  // Toolkit 3.144.0 checks these keys strictly; the heads add none, since \`private\` is open to every reader.
  const OLDER_CHILD_KEYS=['schema','repository','issue','revision','fence','lifecycle','completed_at','release','gate','candidate','pr','uat','review','blockers','next_action','pending_effects','journals_seen','private','volatile','prs','before_close','closed_by_sweep','added_by_sweep'];
  assert.deepEqual(Object.keys(child).filter(key=>!OLDER_CHILD_KEYS.includes(key)),[]);
  for (const entry of child.prs) assert.deepEqual(Object.keys(entry).sort(),['merge_sha','number','state']);
  assert.deepEqual(state.validateChild(child),[]);
  for (const bad of [[{pr:357,head:'short'}],[{pr:357,head:NEW},{pr:374,head:NEW}],[{pr:357,head:NEW,extra:1}],Array.from({length:21},(_,i)=>({pr:357,head:i.toString(16).padStart(40,'0')}))]) {
    assert.ok(state.validateChild({...child,private:{...child.private,pr_heads:bad}}).some(error=>error.startsWith('private.pr_heads')),JSON.stringify(bad).slice(0,60));
  }
});

test('owed UAT T5: past the limit the oldest heads go first, but never the head an owed UAT names',()=>{
  const f=fixture(); pr(f,357,{head:NEW,body:'Refs #2'});
  const old=Array.from({length:20},(_,i)=>({pr:357,head:(i+1).toString(16).padStart(40,'0')}));
  ownerOwing(f, doc=>({pr:{...doc.pr,number:357},uat:{state:'PENDING',at_head:old[0].head},private:{...doc.private,pr_heads:old}}));
  f.run();
  const heads=f.child(2).private.pr_heads.map(entry=>entry.head);
  assert.equal(heads.length,20);
  assert.deepEqual([heads[0],heads[1],heads.at(-1)],[old[0].head,old[2].head,NEW],'the second-oldest went; the UAT\'s head stayed');
  assert.equal(owedOn(f).waiting,'Owner: UAT on PR #357');
});

// Agent UAT first (#1405 row 4): an owed UAT is the agent's step until private.agent_uat records
// PASSED or OWNER_ONLY at the UAT's own head; only then is it the owner's. One decider (uatOwer)
// draws the Waiting on cell, CURRENT, the PR GRAPH and attention's owner waits.
const OTHER_HEAD = 'd'.repeat(40);
const agentRecord = (agentState, head = UAT_HEAD) => ({state:agentState,at_head:head,evidence:'evidence/uat-2-agent/REPORT.md'});
const AGENT_MATRIX = [
  // [row, uat, agent_uat, gate, lifecycle, waiting, CURRENT tail, owner waits, PR row]
  ['1 settled', {state:'NOT_REQUIRED',at_head:null}, agentRecord('FAILED'), null, 'ACTIVE', '-', '', [], '#22 OPEN'],
  ['2 owed, no agent result', null, null, null, 'ACTIVE', 'Agent: UAT on PR #22', ' · agent UAT on PR #22', [], '#22 OPEN · Agent UAT owed'],
  ['3 owed, agent PASSED', null, agentRecord('PASSED'), null, 'ACTIVE', 'Owner: UAT on PR #22', ' · waiting on you: your UAT on PR #22', [2], '#22 OPEN · Owner UAT owed'],
  ['4 owed, OWNER_ONLY', null, agentRecord('OWNER_ONLY'), null, 'ACTIVE', 'Owner: UAT on PR #22', ' · waiting on you: your UAT on PR #22', [2], '#22 OPEN · Owner UAT owed'],
  ['5 owed, agent FAILED', null, agentRecord('FAILED'), null, 'ACTIVE', 'Agent: UAT failed on PR #22', ' · agent UAT failed on PR #22', [], '#22 OPEN · Agent UAT owed'],
  ['6 owed again at a new head', null, agentRecord('PASSED', OTHER_HEAD), null, 'ACTIVE', 'Agent: UAT on PR #22', ' · agent UAT on PR #22', [], '#22 OPEN · Agent UAT owed'],
  ['7 gate waiting on the owner', null, null, {role:'G2',state:'WAITING_OWNER'}, 'ACTIVE', 'Owner: decision', ' · G2 · waiting on you: your decision', [2], '#22 OPEN · G2 WAITING_OWNER · Agent UAT owed'],
  ['8 gate at work, no agent result', null, null, {role:'G2',state:'ACTIVE'}, 'ACTIVE', 'G2, then Agent: UAT on PR #22', ' · G2 · then agent UAT on PR #22', [], '#22 OPEN · G2 ACTIVE · Agent UAT owed'],
  ['8b gate at work, agent PASSED', null, agentRecord('PASSED'), {role:'G2',state:'ACTIVE'}, 'ACTIVE', 'G2, then Owner: UAT on PR #22', ' · G2 · then your UAT on PR #22', [2], '#22 OPEN · G2 ACTIVE · Owner UAT owed'],
  ['I1 task waiting on the owner, no agent result', null, null, null, 'WAITING_OWNER', 'Agent: UAT on PR #22', ' · agent UAT on PR #22', [], '#22 OPEN · Agent UAT owed'],
  ['I1 task waiting on the owner, agent PASSED', null, agentRecord('PASSED'), null, 'WAITING_OWNER', 'Owner: UAT on PR #22', ' · waiting on you: your UAT on PR #22', [2], '#22 OPEN · Owner UAT owed'],
];
for (const [row, uat, agent, gate, lifecycle, waiting, tail, waits, prRow] of AGENT_MATRIX) test(`agent UAT first row ${row}: ${waiting}`,()=>{
  const f=fixture(); pr(f,22,{head:UAT_HEAD,body:'Refs #2'});
  owing(f, doc=>({pr:{...doc.pr,number:22},lifecycle,...(uat ? {uat} : {}),...(gate ? {gate:{...doc.gate,...gate}} : {}),...(agent ? {private:{...doc.private,agent_uat:agent}} : {})}));
  f.run();
  const seen=owedOn(f);
  assert.equal(seen.waiting,waiting,'the Waiting on cell');
  assert.equal(seen.current,`- #2 Issue 2 · PR #22${tail}`,'CURRENT agrees with the cell');
  assert.deepEqual(seen.prRows,[prRow],'the PR GRAPH says whose UAT is owed');
  assert.deepEqual(state.ownerWaits(f.parent(),new Map([[2,f.child(2)]])).map(entry=>entry.issue),waits,'attention lists an owner wait only for the owner\'s step');
  assert.deepEqual(state.validateChild(f.child(2)),[]);
});

const statusOf = (f, n = 2) => f.github.issues.get(1).body.split('\n').find(line => line.startsWith('|') && line.includes(`|#${n}|`)).slice(1, -1).split('|')[2];
test('agent UAT first (#1405): a merged task with a UAT owed and no agent result reads NOW · AGENT UAT and never waits on the owner',()=>{
  const f=fixture(); pr(f,22,merged('2026-11-07T00:00:00Z','Refs #2',{head:UAT_HEAD}));
  owing(f, doc=>({pr:{...doc.pr,number:22},uat:{state:'PENDING',at_head:UAT_HEAD}}));
  f.run();
  assert.deepEqual([statusOf(f),owedOn(f).waiting],['NOW · AGENT UAT','Agent: UAT on PR #22, not started']);
  assert.equal(owedOn(f).current,'- #2 Issue 2 · PR #22 · merged, awaiting proof · agent UAT on PR #22, not started');
  assert.doesNotMatch(f.github.issues.get(1).body,/waiting on you/);
  assert.deepEqual(state.ownerWaits(f.parent(),new Map([[2,f.child(2)]])),[]);
  // The agent's FAILED result keeps it the agent's; its PASS hands the UAT to the owner.
  f.store.mutate('child',2,{writer:holder,parentDoc:f.parent(),change:doc=>({...doc,private:{...doc.private,agent_uat:agentRecord('FAILED')}})}); f.run();
  assert.deepEqual([statusOf(f),owedOn(f).waiting],['NOW · AGENT UAT','Agent: UAT failed on PR #22']);
  f.store.mutate('child',2,{writer:holder,parentDoc:f.parent(),change:doc=>({...doc,private:{...doc.private,agent_uat:agentRecord('PASSED')}})}); f.run();
  assert.deepEqual([statusOf(f),owedOn(f).waiting],['MERGED · awaiting proof','Owner: UAT on PR #22']);
  const waitOf = () => state.ownerWaits(f.parent(),new Map([[2,f.child(2)]])).map(entry=>[entry.issue,entry.agent_uat,entry.uat_head,entry.pr_state,entry.head]);
  assert.deepEqual(waitOf(),[[2,'PASSED',UAT_HEAD,'MERGED',UAT_HEAD]]);
  // A UAT owed at a train merge names that head, not the PR head: the owner's OK is recorded there.
  const TRAIN='d'.repeat(40);
  f.store.mutate('child',2,{writer:holder,parentDoc:f.parent(),change:doc=>({...doc,uat:{...doc.uat,at_head:TRAIN},private:{...doc.private,agent_uat:agentRecord('PASSED',TRAIN)}})}); f.run();
  assert.deepEqual(waitOf(),[[2,'PASSED',TRAIN,'MERGED',UAT_HEAD]]);
  // OWNER_ONLY hands it over too, but says the owner must still test: never a close OK.
  f.store.mutate('child',2,{writer:holder,parentDoc:f.parent(),change:doc=>({...doc,private:{...doc.private,agent_uat:agentRecord('OWNER_ONLY',TRAIN)}})}); f.run();
  assert.deepEqual(state.ownerWaits(f.parent(),new Map([[2,f.child(2)]])).map(entry=>[entry.issue,entry.agent_uat]),[[2,'OWNER_ONLY']]);
});

// The stale check offers the owner a close only when no gate is live on the task. ownerStep's `after`
// misses two live gates (a gate at work on a task waiting on the owner, and a blocked gate), so every
// owner wait carries gate_live: any gate state but RETIRED (assigned, active, submitted, interrupted or
// waiting on the owner), blocked or not.
test('owner waits carry gate_live for a non-final gate on the task, blocked or not, and none for a retired or no gate',()=>{
  const cases = [
    ['gate at work, task waiting on the owner', 'WAITING_OWNER', {role:'G2',state:'ACTIVE'}, [], true],
    ['blocked live gate', 'ACTIVE', {role:'G1',state:'ACTIVE'}, ['Laptop offline'], true],
    ['submitted gate, agent UAT passed', 'ACTIVE', {role:'G1',state:'SUBMITTED'}, [], true],
    ['interrupted gate, agent UAT passed', 'ACTIVE', {role:'G1',state:'INTERRUPTED'}, [], true],
    ['retired gate, agent UAT passed', 'ACTIVE', {role:'G1',state:'RETIRED'}, [], false],
    ['no gate', 'ACTIVE', null, [], false],
  ];
  for (const [name, lifecycle, gate, blockers, live] of cases) {
    const f=fixture(); pr(f,22,merged('2026-11-07T00:00:00Z','Refs #2',{head:UAT_HEAD}));
    owing(f, doc=>({pr:{...doc.pr,number:22},lifecycle,uat:{state:'PENDING',at_head:UAT_HEAD},...(gate ? {gate:{...doc.gate,...gate}} : {}),blockers,private:{...doc.private,agent_uat:agentRecord('PASSED')}}));
    f.run();
    const waits=state.ownerWaits(f.parent(),new Map([[2,f.child(2)]]));
    assert.deepEqual(waits.map(entry=>[entry.issue,entry.agent_uat,entry.gate_live]),[[2,'PASSED',live]],name);
  }
});

test('agent UAT first: a listed blocker still queues a merged task and shows in place of the agent step',()=>{
  const f=fixture(); pr(f,22,merged('2026-11-07T00:00:00Z','Refs #2',{head:UAT_HEAD}));
  owing(f, doc=>({pr:{...doc.pr,number:22},uat:{state:'PENDING',at_head:UAT_HEAD},blockers:['Laptop offline']}));
  f.run();
  assert.deepEqual([statusOf(f),owedOn(f).waiting],['NOW · QUEUED','Blocked: Laptop offline']);
  assert.equal(owedOn(f).current,'- #2 Issue 2 · PR #22 · blocked: Laptop offline');
});

test('agent UAT first: NOW · AGENT UAT rows sort after work in progress and before merged rows awaiting proof',()=>{
  const f=fixture([2,3,4]);
  pr(f,22,merged('2026-11-07T00:00:00Z','Refs #2',{head:UAT_HEAD})); pr(f,33,{head:NEW,body:'Refs #3'}); pr(f,44,merged('2026-11-07T00:00:00Z','Refs #4',{head:OTHER_HEAD}));
  owing(f, doc=>({pr:{...doc.pr,number:22},uat:{state:'PENDING',at_head:UAT_HEAD}}));
  f.store.mutate('child',3,{writer:holder,parentDoc:f.parent(),change:doc=>({...doc,pr:{...doc.pr,number:33}})});
  f.store.mutate('child',4,{writer:holder,parentDoc:f.parent(),change:doc=>({...doc,pr:{...doc.pr,number:44}})});
  f.run();
  const rows=f.github.issues.get(1).body.split('\n').filter(line=>/^\|[^|]*\|#\d+\|/.test(line)).map(line=>line.split('|').slice(2,4).join(' '));
  assert.deepEqual(rows,['#3 NOW · IN PROGRESS','#2 NOW · AGENT UAT','#4 MERGED · awaiting proof']);
  assert.match(f.github.issues.get(1).body,/Order: NOW · IN PROGRESS, NOW · AGENT UAT, MERGED · awaiting proof, NOW · QUEUED, LATER/);
});

const OWNER_PASS = {uat:{state:'PASSED',at_head:UAT_HEAD}};
const owedDoc = (f, agent) => ({...f.child(2),uat:{state:'PENDING',at_head:UAT_HEAD},private:{...f.child(2).private,...(agent ? {agent_uat:agent} : {})}});
for (const [name, agent, allowed] of [['no agent result',null,false],['agent PASSED',agentRecord('PASSED'),true],['OWNER_ONLY',agentRecord('OWNER_ONLY'),true],
  ['agent FAILED',agentRecord('FAILED'),false],['agent PASSED at an older head',agentRecord('PASSED',OTHER_HEAD),false]]) test(`agent UAT first guard: owner PASS with ${name} is ${allowed ? 'allowed' : 'refused'}`,()=>{
  const f=fixture(); const doc=owedDoc(f,agent);
  const write=()=>state.applyPatch('child',doc,OWNER_PASS,{writer:holder,parentDoc:f.parent()});
  if (allowed) assert.equal(write().uat.state,'PASSED');
  else assert.throws(write,{code:'UAT_AGENT_FIRST'});
});

test('agent UAT first guard: one controller write may record the agent result and the owner PASS; a settled PASS is not re-checked',()=>{
  const f=fixture();
  const both=state.applyPatch('child',owedDoc(f,null),{...OWNER_PASS,private:{agent_uat:agentRecord('PASSED')}},{writer:holder,parentDoc:f.parent()});
  assert.deepEqual([both.uat.state,both.private.agent_uat.state],['PASSED','PASSED']);
  const settled={...f.child(2),uat:{state:'PASSED',at_head:UAT_HEAD}};
  assert.equal(state.applyPatch('child',settled,{next_action:'Close the task'},{writer:holder,parentDoc:f.parent()}).uat.state,'PASSED','a PASS recorded before the guard stays');
  for (const uat of [{state:'NOT_REQUIRED',at_head:null},{state:'UAT_RETAINED',at_head:UAT_HEAD},{state:'UAT_FULL_REQUIRED',at_head:OTHER_HEAD}]) {
    assert.equal(state.applyPatch('child',owedDoc(f,null),{uat},{writer:holder,parentDoc:f.parent()}).uat.state,uat.state,`${uat.state} is not guarded`);
  }
});

test('agent UAT first: only the controller writes or removes the agent record',()=>{
  const f=fixture(); const executor={session:'executor',prefix:'BUILD-'};
  assert.throws(()=>state.applyPatch('child',owedDoc(f,null),{private:{agent_uat:agentRecord('PASSED')}},{writer:executor,parentDoc:f.parent()}),{code:'ROLE_REFUSED'});
  for (const patch of [{private:null},{private:{agent_uat:null}},{private:{agent_uat:{state:'FAILED'}}}]) {
    assert.throws(()=>state.applyPatch('child',owedDoc(f,agentRecord('PASSED')),patch,{writer:executor,parentDoc:f.parent()}),{code:'ROLE_REFUSED'},JSON.stringify(patch));
  }
  assert.equal(state.applyPatch('child',owedDoc(f,agentRecord('PASSED')),{private:{keep_open:{reason:'Follow-up'}}},{writer:executor,parentDoc:f.parent()}).private.agent_uat.state,'PASSED','other private keys stay open to every writer');
  assert.equal(state.applyPatch('child',owedDoc(f,null),{private:{agent_uat:agentRecord('PASSED')}},{writer:holder,parentDoc:f.parent()}).private.agent_uat.state,'PASSED');
});

test('agent UAT first: the record\'s shape is checked and adds no key older readers refuse',()=>{
  const f=fixture(); const child=owedDoc(f,agentRecord('PASSED'));
  assert.deepEqual(state.validateChild(child),[]);
  const OLDER_CHILD_KEYS=['schema','repository','issue','revision','fence','lifecycle','completed_at','release','gate','candidate','pr','uat','review','blockers','next_action','pending_effects','journals_seen','private','volatile','prs','before_close','closed_by_sweep','added_by_sweep'];
  assert.deepEqual(Object.keys(child).filter(key=>!OLDER_CHILD_KEYS.includes(key)),[]);
  assert.deepEqual(Object.keys(child.uat).sort(),['at_head','state'],'uat keeps its strict shape');
  for (const bad of [{state:'PASS',at_head:UAT_HEAD,evidence:'x'},{state:'PASSED',at_head:'short',evidence:'x'},{state:'PASSED',at_head:UAT_HEAD},{state:'PASSED',at_head:UAT_HEAD,evidence:''},
    {state:'PASSED',at_head:UAT_HEAD,evidence:'x'.repeat(501)},{state:'PASSED',at_head:UAT_HEAD,evidence:'x',extra:1},{state:'PASSED',at_head:UAT_HEAD,evidence:'ghp_'+'a'.repeat(36)},null,[]]) {
    assert.ok(state.validateChild({...child,private:{...child.private,agent_uat:bad}}).some(error=>error.startsWith('private.agent_uat')),JSON.stringify(bad)?.slice(0,60));
  }
});

test('a complete pass advances the private close watermark; old closes and parent links stay excluded',()=>{
  const f=fixture(); f.run(); const watermark=f.parent().private.graph_pr_watermark; assert.ok(watermark);
  pr(f,20,{state:'CLOSED'}); f.github.prs.get(20).closedAt='2026-11-07T00:00:00Z';
  pr(f,21,{state:'CLOSED'}); f.github.prs.get(21).closedAt='2026-11-08T01:00:00Z';
  pr(f,22,{body:'Refs #1'}); f.time(epoch+2*3600000); f.run();
  assert.deepEqual(f.parent().attention.filter(e=>e.code==='PR_WITHOUT_TASK').map(e=>e.issue),[21]);
  assert.equal(f.parent().private.graph_pr_watermark,new Date(epoch+2*3600000).toISOString());
});

test('the discovery budget grows with the board; truncated connections preserve the prior list and watermark',()=>{
  const f=fixture(); pr(f,20,{body:'Refs #2'}); f.run(); const before=f.child(2).prs; const watermark=f.parent().private.graph_pr_watermark;
  f.github.issuePrLinks.set(2,{closingTruncated:true}); f.time(epoch+3600000);
  const tasks=f.parent().outcomes.length; const budget=state.discoveryBudget(tasks);
  assert.equal(budget,state.DISCOVERY_BASE+Math.ceil(tasks/20)+2*tasks);
  const pass=f.pass(); const plan=pass.plan(); assert.equal(plan.complete,false); assert.ok(plan.observed.prGraph.requests-plan.observed.prGraph.pages<=budget);
  pass.apply(plan); assert.deepEqual(f.child(2).prs,before); assert.equal(f.parent().private.graph_pr_watermark,watermark);
  // List pages never stop discovery: sixty-one pages of each list are read whole.
  const paged=f.pass();
  paged.reader.graphPullRequests=(_status,page)=>{for(let i=0;i<61;i++)page();return [];};
  const listed=paged.plan();
  assert.ok(listed.observed.prGraph.requests>=122); assert.ok([...listed.observed.prGraph.discovery].filter(([number])=>number!==2).every(([,entry])=>entry.complete),'no task loses discovery to list pages (only #2 is truncated)');
  // Task link reads are bounded by the grown budget, never by a fixed sixty.
  const bounded=f.pass();
  bounded.reader.issuePullRequestLinks=(_numbers,spend)=>{for(let i=0;i<budget+5;i++)spend();return new Map();};
  const large=bounded.plan();
  assert.equal(large.observed.prGraph.requests-large.observed.prGraph.pages,budget); assert.equal(large.complete,false);
  // A board of 1,500 tasks gets a budget that covers its 75 link batches.
  assert.ok(state.discoveryBudget(1500,0)-state.DISCOVERY_BASE>=75);
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
  const f=fixture(); f.run(); pr(f,20); pr(f,21,{state:'CLOSED'}); f.github.prs.get(21).closedAt='2026-11-08T00:30:00Z'; f.run();
  f.github.prs.get(20).body='Refs #2'; f.time(epoch+3600000); f.run();
  assert.equal(f.parent().attention.find(e=>e.code==='PR_WITHOUT_TASK' && e.issue===20).state,'resolved');
  assert.equal(f.parent().attention.find(e=>e.code==='PR_WITHOUT_TASK' && e.issue===21).state,'new');
});

for(const [start,reason] of [['DONE','not_planned'],['RETIRED','completed']]) test(`close matrix: ${start} disagrees with GitHub ${reason}`,()=>{
  const f=fixture(); f.store.mutate('child',2,{writer:holder,parentDoc:f.parent(),change:doc=>({...doc,lifecycle:start})});
  f.close(2,reason); const report=f.run(); assert.equal(f.child(2).lifecycle,start);
  assert.ok(!f.child(2).before_close); assert.ok(!f.child(2).closed_by_sweep);
  assert.ok(report.findings.some(e=>e.code==='CHILD_STATE_CONFLICT' && e.issue===2));
  assert.ok(!openCodes(f).includes('CLOSED_WITHOUT_ACCEPTANCE'));
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

// A merge train PR carries its members: it Refs every member's task and merges them all, so the
// member PR (merged indirectly) must stay the task's PR and the train must never join its history.
const trainBody = (members, refs, head = SHA) => ['## Merge train', '', '| Member | Reviewed head | Tier | Bump | Review |', '|---|---|---|---|---|',
  ...members.map(n => `| #${n} | \`${head}\` | NORMAL | patch | PASS |`), '', 'UAT: NOT_REQUIRED (no member needs an owner test)', '', ...refs.map(n => `Refs #${n}`)].join('\n');

test('merge train carrier: a merged train stays out of task history and backfill, even on a merge-time tie', () => {
  const f = fixture([2,3]);
  // Finished by the controller before the close is copied, so the pass backfills the merged PR.
  for (const task of [2,3]) f.store.mutate('child',task,{writer:holder,parentDoc:f.parent(),change:doc=>({...doc,lifecycle:'DONE',completed_at:new Date(epoch).toISOString()})});
  f.close(2); f.close(3);
  const at = '2026-11-07T00:00:00Z';
  pr(f,21,{merged:true,mergedAt:at,body:'Closes #2'}); pr(f,22,{merged:true,mergedAt:at,body:'Closes #3'});
  pr(f,30,{merged:true,mergedAt:at,body:trainBody([21,22],[2,3])});
  f.github.issuePrLinks.set(2,{closing:[21],timeline:[30]}); f.github.issuePrLinks.set(3,{closing:[22],timeline:[30]});
  assert.deepEqual(f.run().holds,[]);
  for (const [task, member] of [[2,21],[3,22]]) {
    assert.deepEqual(f.child(task).prs.map(p => p.number),[member]);
    assert.equal(f.child(task).pr.number,member,'the member, not the train, is the task\'s merged PR');
  }
  assert.ok(!(f.parent().attention || []).some(e => e.code === 'PR_WITHOUT_TASK' && e.issue === 30));
});

test('merge train carrier: an open train gets no PATH or STATUS block and no task history', () => {
  const f = fixture([2]); pr(f,21,{body:'Refs #2'}); pr(f,30,{body:trainBody([21],[2])});
  const before = f.github.prs.get(30).body;
  assert.deepEqual(f.run().holds,[]);
  assert.deepEqual(f.child(2).prs.map(p => p.number),[21]);
  assert.equal(f.github.prs.get(30).body,before,'the train body is never rewritten');
  assert.ok(!(f.parent().attention || []).some(e => e.code === 'PR_WITHOUT_TASK' && e.issue === 30));
});

test('merge train carrier: a train saved in task history before this rule is dropped on the next pass', () => {
  const f = fixture([2]); pr(f,21,{merged:true,mergedAt:'2026-11-07T00:00:00Z',body:'Refs #2'});
  pr(f,30,{merged:true,mergedAt:'2026-11-07T00:00:00Z',body:trainBody([21],[2])});
  f.store.mutate('child',2,{writer:holder,parentDoc:f.parent(),change:doc=>({...doc,prs:[{number:30,state:'MERGED',merge_sha:SHA},{number:21,state:'MERGED',merge_sha:SHA}]})});
  f.time(epoch + 86400000);
  assert.deepEqual(f.run().holds,[]);
  assert.deepEqual(f.child(2).prs.map(p => p.number),[21]);
});

test('merge train carrier: a pasted train table on a PR that carried no member stays in task history', () => {
  const f = fixture([2,3]);
  pr(f,21,{merged:true,mergedAt:'2026-11-01T00:00:00Z',body:'Refs #2'});
  pr(f,31,{merged:true,mergedAt:'2026-11-07T00:00:00Z',body:trainBody([21],[2])});
  pr(f,22,{body:'Refs #3'}); pr(f,32,{body:trainBody([22],[3],'c'.repeat(40))});
  assert.deepEqual(f.run().holds,[]);
  assert.deepEqual(f.child(2).prs.map(p => p.number),[31,21],'merged a week after its "member": not its carrier');
  assert.deepEqual(f.child(3).prs.map(p => p.number).sort((a,b)=>a-b),[22,32],'an open table whose head is not the member\'s head: not its carrier');
});

// GitHub returns 100 cross-references a page. A busy task passed that (113 on one live task), its
// links read as incomplete on every pass, and no pass could finish, so a stopped-pass finding never
// cleared. The links now page on, and a pass over such a task finishes.
const crossRefs = (count, prs) => [...Array.from({ length: count - prs.length }, () => ({ __typename: 'Issue' })), ...prs];

test('a task with more than 100 cross-references reads them all: its PRs past the first page are in its history and the pass completes', () => {
  const f = fixture([2, 3]); f.run();
  pr(f, 30, { body: '' }); pr(f, 31, { body: '' });
  f.github.issuePrLinks.set(2, { timeline: crossRefs(113, [30, 31]) });
  const pass = f.pass(); const plan = pass.plan();
  assert.equal(plan.observed.prGraph.discovery.get(2).complete, true);
  assert.equal(plan.complete, true);
  pass.apply(plan);
  assert.deepEqual(f.child(2).prs.map(entry => entry.number).sort((a, b) => a - b), [30, 31]);
  assert.ok(!openCodes(f).includes('PR_DISCOVERY_INCOMPLETE'));
});

test('a stopped-pass finding clears on the next complete pass even when a task has more than 100 cross-references', () => {
  const f = fixture([2, 3]); f.run();
  f.github.issuePrLinks.set(2, { timeline: crossRefs(150, []) });
  f.store.mutate('parent', 1, { writer: holder, change: doc => {
    doc.attention = state.foldAttention(doc.attention, { source: 'reconcile', complete: false, now: new Date(epoch).toISOString(),
      seen: [{ code: 'PASS_STOPPED', issue: 1, diagnostics: { cause: 'time_limit', phase: 'closing', done: 1, total: 72, started_at: new Date(epoch).toISOString() } }] });
    return doc;
  } });
  assert.deepEqual(f.run().holds, []);
  assert.equal(f.parent().attention.find(entry => entry.code === 'PASS_STOPPED').state, 'resolved');
});

test('links GitHub will not page past (no cursor) still leave the task incomplete', () => {
  const f = fixture([2, 3]); f.run();
  f.github.issuePrLinks.set(2, { timeline: crossRefs(150, []), timelineTruncated: true });
  const plan = f.pass().plan();
  assert.equal(plan.observed.prGraph.discovery.get(2).complete, false);
  assert.equal(plan.complete, false);
});

test('a stop for the whole pass raised while reading a later page of links stops the pass; any other failure leaves only that task incomplete', () => {
  for (const code of ['PASS_STOPPED', 'GH_AUTH', 'OTHER']) {
    const f = fixture([2, 3]); f.run();
    f.github.issuePrLinks.set(2, { timeline: crossRefs(150, []) });
    const request = f.github.request.bind(f.github);
    f.github.request = (method, requestPath, body) => {
      if (requestPath === 'graphql' && /more: issue/.test(body?.query || '')) throw new state.ProgrammeError(code, `${code} on a later page`);
      return request(method, requestPath, body);
    };
    if (code === 'OTHER') {
      const plan = f.pass().plan();
      assert.equal(plan.observed.prGraph.discovery.get(2).complete, false);
      assert.equal(plan.complete, false);
    } else if (code === 'PASS_STOPPED') {
      const plan = f.pass().plan();
      assert.equal(plan.stopped, true, 'the pass stops, not just the task');
      assert.deepEqual(plan.holds.map(hold => hold.code), ['PASS_STOPPED']);
    } else {
      assert.throws(() => f.pass().plan(), error => error.code === code, code);
    }
  }
});

// Self-record: a task whose state records no PR and no branch takes the one open PR that claims it.
const unrecorded = (numbers = [2]) => {
  const f=fixture(numbers);
  for(const n of numbers) f.store.mutate('child',n,{writer:holder,parentDoc:f.parent(),change:doc=>({...doc,lifecycle:'PLANNED'})});
  return f;
};
const graphRow = (f, n) => (new RegExp(`\\|#${n}\\|([A-Z]+)[^|]*\\|`).exec(f.github.issues.get(1).body) || [])[1];
const untracked = (report, n = 2) => report.findings.filter(e=>e.code==='PR_UNTRACKED' && e.issue===n);
const pathOnly = (number, chain) => state.renderBlock(state.renderPrNavBlockBody([chain],number),'3.55.1',state.NAV_BLOCK_NAME);
const recorded = (f, n = 2) => { const doc=f.child(n); return [doc.pr.number,doc.pr.state,doc.candidate.branch,doc.lifecycle]; };
const UNRECORDED = [null,null,null,'PLANNED'];

test('self-record S1: the one open PR that claims an unrecorded task is recorded, the task goes ACTIVE and shows NOW',()=>{
  const f=unrecorded(); pr(f,20,{body:'Refs #2',branch:'feature-x',head:NEW});
  const plan=f.pass().plan();
  const effect=plan.effects.find(e=>e.kind==='update_state' && e.target.issue===2);
  assert.deepEqual(effect.record,{selected:20,branch:'feature-x',head:NEW});
  assert.match(effect.text,/record open PR #20 \(branch feature-x\), the one PR that claims the task/);
  const report=f.run();
  assert.deepEqual(recorded(f),[20,'OPEN','feature-x','ACTIVE']);
  assert.equal(f.child(2).candidate.head,NEW);
  assert.deepEqual(f.child(2).private.pr_heads,[{pr:20,head:NEW}]);
  assert.equal(graphRow(f,2),'NOW');
  assert.deepEqual(untracked(report),[]);
  assert.ok(!openCodes(f).includes('PR_UNTRACKED'));
  const doc=f.child(2);
  assert.deepEqual([doc.gate.role,doc.gate.state,doc.uat.state,doc.review.state,doc.next_action],[null,null,null,null,'Controller: admit and plan this outcome']);
  f.run(); assert.deepEqual(recorded(f),[20,'OPEN','feature-x','ACTIVE']);
});

test('self-record S2: a PR whose only reference is its PATH block claims the task; a PATH block naming another PR claims nothing',()=>{
  const f=unrecorded([2,3]);
  pr(f,20,{body:pathOnly(20,[1,2]),branch:'path-only'}); pr(f,21,{body:pathOnly(99,[1,3]),branch:'copied'});
  f.run();
  assert.deepEqual(recorded(f,2),[20,'OPEN','path-only','ACTIVE']);
  assert.deepEqual(recorded(f,3),UNRECORDED);
  assert.equal(graphRow(f,2),'NOW');
});

test('self-record S3: a draft PR is recorded as DRAFT and shows NOW',()=>{
  const f=unrecorded(); pr(f,20,{body:'Refs #2',branch:'draft-x',isDraft:true});
  f.run();
  assert.deepEqual(recorded(f),[20,'DRAFT','draft-x','ACTIVE']);
  assert.equal(graphRow(f,2),'NOW');
});

test('self-record S4: a PR from a fork, a bot or a generated branch is never recorded; a finding names it',()=>{
  for(const options of [{headRepository:'someone/app'},{headRepository:null},{author:'renovate[bot]'},{author:'github-actions[bot]'},{author:'app/github-actions'},{branch:'toolkit/shard-timings-2026-11-16'}]) {
    const f=unrecorded(); pr(f,20,{body:'Refs #2',branch:'patch-1',...options});
    const report=f.run();
    assert.deepEqual(recorded(f),UNRECORDED,JSON.stringify(options));
    const [finding]=untracked(report);
    assert.match(finding.detail,/open PR #20 claims this task but comes from a fork, a bot or a generated branch/,JSON.stringify(options));
  }
});

test('self-record S4b: an open merge train is never a claimant, so its member is the one PR recorded; a task that records only a branch is left as it is',()=>{
  const f=unrecorded(); pr(f,21,{body:'Refs #2',branch:'member'}); pr(f,30,{body:trainBody([21],[2]),branch:'claude/train-1'});
  const report=f.run();
  assert.deepEqual(recorded(f),[21,'OPEN','member','ACTIVE']);
  assert.deepEqual(untracked(report),[]);
  // A train that GitHub links as closing a task its member does not name still claims nothing there.
  const t=unrecorded([2,3]); pr(t,21,{body:'Refs #3',branch:'member'}); pr(t,30,{body:trainBody([21],[2]),branch:'claude/train-1'});
  t.github.issuePrLinks.set(2,{closing:[30]});
  t.run();
  assert.deepEqual(recorded(t,2),UNRECORDED);
  assert.deepEqual(recorded(t,3),[21,'OPEN','member','ACTIVE']);
  const g=unrecorded(); pr(g,20,{body:'Refs #2',branch:'feature-x'});
  g.store.mutate('child',2,{writer:holder,parentDoc:g.parent(),change:doc=>({...doc,candidate:{...doc.candidate,branch:'hand-picked'}})});
  const plan=g.pass().plan();
  assert.ok(!plan.effects.some(e=>e.record),'no record where the controller named a branch');
  g.run();
  assert.deepEqual(recorded(g),[null,null,'hand-picked','PLANNED']);
});

test('self-record S4c: a task with no state yet is created with the one open PR that claims it',()=>{
  const f=fixture([2]); f.github.addIssue(3,{parent:1});
  f.store.mutate('parent',1,{writer:holder,change:doc=>({...doc,outcomes:[...doc.outcomes,{issue:3,label:'Task 3',class:'COMMITTED',parent:1,order:2}]})});
  pr(f,20,{body:'Refs #3',branch:'fresh',head:NEW});
  const effect=f.pass().plan().effects.find(e=>e.target.issue===3 && e.kind==='create_state');
  assert.deepEqual(effect.record,{selected:20,branch:'fresh',head:NEW});
  f.run();
  const doc=f.child(3);
  assert.deepEqual([doc.pr.number,doc.pr.state,doc.candidate.branch,doc.candidate.head,doc.lifecycle],[20,'OPEN','fresh',NEW,'ACTIVE']);
});

test('self-record S5: two open claimants stay report-only, with a finding naming both',()=>{
  const f=unrecorded(); pr(f,20,{body:'Refs #2',branch:'a'}); pr(f,21,{body:'Closes #2',branch:'b'});
  const report=f.run();
  assert.deepEqual(recorded(f),UNRECORDED);
  assert.equal(graphRow(f,2),'LATER');
  assert.match(untracked(report)[0].detail,/open PRs #20, #21 claim this task/);
});

test('self-record S6: a claimant on a finished or retired task is never recorded; a finding names it',()=>{
  for(const [reason,lifecycle] of [['completed','DONE'],['not_planned','RETIRED']]) {
    const f=unrecorded(); pr(f,20,{body:'Refs #2',branch:'late'}); f.close(2,reason);
    const report=f.run();
    assert.deepEqual(recorded(f),[null,null,null,lifecycle],reason);
    assert.match(untracked(report)[0].detail,/open PR #20 claims this finished or retired task/,reason);
  }
});

test('self-record S7: a pass with incomplete discovery writes nothing',()=>{
  // The open PR list cannot be read.
  const f=unrecorded(); pr(f,20,{body:'Refs #2',branch:'feature-x'});
  let down=true;
  f.github.intercept(call=>down && call.method==='GET' && /pulls\?state=open/.test(call.path) ? {status:503,json:{}} : null);
  let report=f.run();
  assert.deepEqual(recorded(f),UNRECORDED);
  assert.ok(report.findings.some(e=>e.code==='PR_DISCOVERY_INCOMPLETE' && e.issue===2));
  // The task's own links cannot all be read.
  const g=unrecorded(); pr(g,20,{body:'Refs #2',branch:'feature-x'});
  g.github.issuePrLinks.set(2,{timelineTruncated:true});
  report=g.run();
  assert.deepEqual(recorded(g),UNRECORDED);
  assert.ok(report.findings.some(e=>e.code==='PR_DISCOVERY_INCOMPLETE' && e.issue===2));
  // The PR is listed open but reads closed.
  const c=unrecorded(); pr(c,20,{body:'Refs #2',branch:'feature-x'});
  const graphql=c.github.graphql.bind(c.github);
  let closedRead=true;
  c.github.graphql=(query,variables)=>{ const out=graphql(query,variables); return closedRead && variables?.number===20 && out?.repository?.pullRequest ? {...out,repository:{...out.repository,pullRequest:{...out.repository.pullRequest,state:'CLOSED'}}} : out; };
  report=c.run();
  assert.deepEqual(recorded(c),UNRECORDED);
  assert.ok(report.findings.some(e=>e.code==='PR_DISCOVERY_INCOMPLETE' && e.issue===2));
  // The first complete pass records it.
  down=false; closedRead=false; g.github.issuePrLinks.delete(2);
  for(const h of [f,g,c]) { h.run(); assert.deepEqual(recorded(h),[20,'OPEN','feature-x','ACTIVE']); }
});

test('self-record S8: a recorded PR that merged moves to the one newer open PR that claims the task through its PATH block; with no claimant it keeps its final state',()=>{
  const f=tracking('MERGED'); pr(f,23,{body:pathOnly(23,[1,2]),head:NEW});
  f.run();
  assert.deepEqual([...tracked(f),f.child(2).pr.head],[23,'OPEN',NEW]);
  const g=tracking('CLOSED'); g.run();
  assert.deepEqual(tracked(g),[22,'CLOSED']);
});

test('self-record S9: a record written after planning is never overwritten',()=>{
  const f=unrecorded(); pr(f,20,{body:'Refs #2',branch:'feature-x'});
  const pass=f.pass(); const plan=pass.plan();
  f.store.mutate('child',2,{writer:holder,parentDoc:f.parent(),change:doc=>({...doc,candidate:{...doc.candidate,branch:'controller-pick'}})});
  const result=pass.apply(plan);
  assert.deepEqual(recorded(f),[null,null,'controller-pick','PLANNED']);
  assert.ok(result.holds.some(h=>h.target==='#2'));
  // A task finished after planning gets no record either.
  const g=unrecorded(); pr(g,20,{body:'Refs #2',branch:'feature-x'});
  const later=g.pass(); const planned=later.plan();
  g.store.mutate('child',2,{writer:holder,parentDoc:g.parent(),change:doc=>({...doc,lifecycle:'DONE'})});
  assert.ok(later.apply(planned).holds.some(h=>h.target==='#2'));
  assert.deepEqual(recorded(g),[null,null,null,'DONE']);
});

test('self-record S10: while nothing is bound to the recorded head, a push moves it and raises no PR_HEAD_MOVED; a bound head stays and is reported',()=>{
  const f=unrecorded(); pr(f,20,{body:'Refs #2',branch:'feature-x',head:SHA});
  f.run(); assert.equal(f.child(2).candidate.head,SHA);
  f.github.prs.get(20).head=NEW;
  const effect=f.pass().plan().effects.find(e=>e.kind==='update_state' && e.target.issue===2);
  assert.deepEqual(effect.follow,{from:SHA,to:NEW});
  assert.match(effect.text,new RegExp(`follow the PR head from ${SHA.slice(0,7)} to ${NEW.slice(0,7)}, with no gate return, review or UAT bound to it`));
  const report=f.run();
  assert.equal(f.child(2).candidate.head,NEW);
  assert.ok(!report.findings.some(e=>e.code==='PR_HEAD_MOVED'));
  // A review bound to the head keeps it, and the move is reported.
  const g=unrecorded(); pr(g,20,{body:'Refs #2',branch:'feature-x',head:SHA}); g.run();
  g.store.mutate('child',2,{writer:holder,parentDoc:g.parent(),change:doc=>({...doc,review:{state:'PASSED',verdicts:[{reviewer:'g2',verdict:'PASSED',head:SHA}]}})});
  g.github.prs.get(20).head=NEW;
  const bound=g.run();
  assert.equal(g.child(2).candidate.head,SHA);
  assert.ok(bound.findings.some(e=>e.code==='PR_HEAD_MOVED' && e.issue===2));
  // A review bound after planning holds the move.
  const h=unrecorded(); pr(h,20,{body:'Refs #2',branch:'feature-x',head:SHA}); h.run();
  h.github.prs.get(20).head=NEW;
  const pass=h.pass(); const plan=pass.plan();
  h.store.mutate('child',2,{writer:holder,parentDoc:h.parent(),change:doc=>({...doc,uat:{state:'PENDING',at_head:SHA}})});
  assert.ok(pass.apply(plan).holds.some(e=>e.target==='#2'));
  assert.equal(h.child(2).candidate.head,SHA);
  // A head the controller recorded after planning is kept too.
  const k=unrecorded(); pr(k,20,{body:'Refs #2',branch:'feature-x',head:SHA}); k.run();
  k.github.prs.get(20).head=NEW;
  const again=k.pass(); const planned=again.plan();
  const PICKED='c'.repeat(40);
  k.store.mutate('child',2,{writer:holder,parentDoc:k.parent(),change:doc=>({...doc,candidate:{...doc.candidate,head:PICKED}})});
  assert.ok(again.apply(planned).holds.some(e=>e.target==='#2'));
  assert.equal(k.child(2).candidate.head,PICKED);
});
