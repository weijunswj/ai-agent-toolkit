'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = process.env.A2B_SOURCE_ROOT || path.resolve(__dirname, '../..');
const state = require(path.join(ROOT, 'skills/github-program-reconciler/scripts/programme-state.cjs'));
const cli = require(path.join(ROOT, 'skills/github-program-reconciler/scripts/programme.cjs'));
const { pageFixture } = require('./support/programme-page-fixture.cjs');
const { renderScaleFixture } = require('./support/programme-render-scale.cjs');
const SHA = 'a'.repeat(40), START = Date.parse('2026-11-09T00:00:00Z');
const STORY = '<!-- toolkit-closing kind=story -->', FACTS = '<!-- toolkit-closing kind=facts -->';
const scratch = path.resolve('.tmp/a2b-report');
fs.mkdirSync(scratch, { recursive: true });

function fixture(seed = true) {
  const f = pageFixture(state);
  let time = START;
  const now = () => new Date(time).toISOString();
  f.store.now = now;
  f.github.clock = START;
  const pass = (refresh = true, budget = undefined) => new state.Reconciler({ binding:f.binding, store:f.store,
    writer:refresh ? state.refreshWriter(f.parent()) : f.writer, refreshFacts:refresh, now, toolkitVersion:'3.58.0',
    reader:new state.ProgrammeGraphReader({transport:f.github,repository:f.binding.repository}),
    mutator:new state.GitHubMutator({transport:f.github,repository:f.binding.repository}), pass:budget });
  const run = () => pass().run({apply:true});
  const close = (kind, number, options = {}) => {
    if (kind === 'pr') {
      f.github.addPr(number,{head:SHA,state:'CLOSED',merged:options.merged !== false,mergedAt:options.merged === false ? null:now(),body:'Refs #12'});
      Object.assign(f.github.prs.get(number), {closedAt:now(),updated_at:now(), ...options});
    } else Object.assign(f.github.addIssue(number,{state:'closed'}),{state_reason:'completed',closed_at:now(),updated_at:now(),...options});
  };
  const command = (kind, number, body, extra = []) => {
    const file = path.join(scratch,'story.txt'); fs.writeFileSync(file,body);
    const sink = {write() {}};
    return cli.main(['closing-comment',`--${kind}`,String(number),'--body-file',file,...extra],
      {transport:f.github,originUrl:'https://github.com/example.test/app.git',repoRoot:ROOT,stdout:sink,now});
  };
  if (seed) run();
  time += 3600000; f.github.clock = time;
  return {...f,pass,run,close,command,now,advance:hours => {time+=hours*3600000; f.github.clock=time;},
    gaps:() => (f.parent().attention || []).filter(e=>e.code==='CLOSING_COMMENT_MISSING' && ['new','acknowledged'].includes(e.state)),
    facts:() => [...f.github.comments.values()].filter(e=>e.body.includes(FACTS))};
}

test('A2-2: first sweep flags three kinds without posts; stories resolve; repeat writes nothing',()=>{
  const f=fixture(); f.close('pr',20); f.close('pr',21,{merged:false}); f.close('issue',22);
  f.run(); assert.equal(f.gaps().length,3); assert.equal(f.facts().length,0);
  for(const [kind,n] of [['pr',20],['pr',21],['issue',22]]) f.command(kind,n,'Shipped the change. Refs #12');
  f.run(); assert.equal(f.gaps().length,0);
  const before=[f.github.commits,f.github.mutations()]; f.run(); assert.deepEqual([f.github.commits,f.github.mutations()],before);
});
test('A2-2 A2-10: after 24 hours facts stay waiting; a later story resolves without editing facts',()=>{
  const f=fixture(); f.close('pr',20); f.close('pr',21,{merged:false}); f.close('issue',22); f.run();
  f.advance(24); f.github.calls=[]; const report=f.run(); assert.equal(f.facts().length,3); assert.equal(f.gaps().length,3);
  assert.equal(report.writes.github,f.github.calls.filter(c=>['POST','PATCH'].includes(c.method) && c.path!=='graphql' && !c.path.includes('/contents/')).length);
  assert.match(f.facts().find(c=>c.issue===20).body,/aaaaaaa.*[\s\S]*not recorded/i);
  assert.match(f.facts().find(c=>c.issue===21).body,/reason not recorded/);
  assert.match(f.facts().find(c=>c.issue===22).body,/completed/);
  const bodies=f.facts().map(c=>c.body); const before=[f.github.commits,f.github.mutations()];
  f.run(); assert.equal(f.facts().length,3); assert.deepEqual([f.github.commits,f.github.mutations()],before);
  f.command('pr',20,'The story. Refs #12'); f.run(); assert.equal(f.gaps().length,2); assert.deepEqual(f.facts().map(c=>c.body),bodies);
});
test('A2-9: close words and fake tokens are refused; Refs and host footer work',()=>{
  const f=fixture(); f.close('pr',20);
  for(const body of ['Closes #421','Fixes example.test/other#3','Resolves https://github.com/example.test/app/issues/3','ghp_'+'x'.repeat(36)])
    assert.throws(()=>f.command('pr',20,body),e=>['CLOSING_REFERENCE','SECRET_REFUSED'].includes(e.code));
  f.command('pr',20,'Refs #421\n\nHost footer.');
  assert.equal(f.github.commentsOf(20).filter(c=>c.body.includes(STORY)).length,1);
});
test('command matrix: closed only, duplicate guard, force, dry run, no programme writes',()=>{
  const f=fixture(); f.github.addIssue(25); const commits=f.github.commits;
  assert.throws(()=>f.command('issue',25,'Story.'),{code:'ITEM_OPEN'});
  f.close('issue',25); f.command('issue',25,'Story.',['--dry-run']); assert.equal(f.github.commentsOf(25).length,0);
  f.command('issue',25,'Story.'); assert.throws(()=>f.command('issue',25,'Story.'),{code:'ALREADY_COMMENTED'});
  f.command('issue',25,'Another story.',['--force-another']); assert.equal(f.github.commentsOf(25).length,2);
  assert.equal(f.github.commits,commits);
});
test('marker timing and author: unmarked and pre-close comments do not count',()=>{
  const f=fixture(); f.close('issue',20);
  f.github.addComment(20,{body:STORY,createdAt:'2026-11-08T00:00:00Z'});
  f.github.addComment(20,{body:'Owner explained the close.'}); f.run(); assert.equal(f.gaps().length,1);
  f.github.addComment(20,{body:STORY+'\nHost footer.',login:'another-agent'}); f.run(); assert.equal(f.gaps().length,0);
});
test('A2-11: 25 due gaps post twenty then five; intents precede each post',()=>{
  const f=fixture(); for(let n=100;n<125;n++) f.close('issue',n); f.run(); f.advance(24);
  f.github.intercept(call=>{if(call.method==='POST' && /issues\/\d+\/comments$/.test(call.path) && call.body.body.includes(FACTS)) {
    const n=Number(/issues\/(\d+)/.exec(call.path)[1]);
    assert.ok(f.parent().pending_effects.some(e=>e.kind==='post_closing_backstop' && e.target.issue===n && e.state==='IN_FLIGHT'));
  }});
  f.run(); assert.equal(f.facts().length,20); f.run(); assert.equal(f.facts().length,25); assert.equal(f.gaps().length,25);
});
test('no flood: 520 old PRs and 300 old issues seed; new close gives one finding',()=>{
  const f=fixture(false); for(let n=100;n<620;n++) f.close('pr',n,{mergedAt:'2026-11-01T00:00:00Z',closedAt:'2026-11-01T00:00:00Z',updated_at:'2026-11-01T00:00:00Z'});
  for(let n=700;n<1000;n++) f.close('issue',n,{closed_at:'2026-11-01T00:00:00Z',updated_at:'2026-11-01T00:00:00Z'});
  f.run(); assert.equal(f.gaps().length,0); assert.ok(f.parent().private.graph_issue_watermark);
  f.advance(1); f.close('issue',1001); f.run(); assert.equal(f.gaps().length,1);
});
test('scale: 150 closes and 151 comments page within cap, persist unread and continue',()=>{
  const f=fixture(); for(let n=100;n<250;n++) f.close('pr',n);
  for(let i=0;i<150;i++) f.github.addComment(100,{body:'Conversation.'});
  f.github.addComment(100,{body:STORY});
  const plan=f.pass().plan(); assert.ok(plan.observed.closing.incomplete.length>0); assert.ok(plan.observed.closing.requests<=60);
  f.pass().apply(plan); assert.ok(f.gaps().length<149);
  for(let i=0;i<4;i++) f.run(); assert.equal(f.gaps().length,149); assert.ok(!f.gaps().some(e=>e.issue===100));
});
test('unread gaps never resolve; ordinary reconcile holds closing findings',()=>{
  const f=fixture(); f.close('issue',20); f.run(); const before=f.gaps()[0]; assert.ok(before);
  f.pass(false).run({apply:true}); assert.deepEqual(f.gaps()[0],before);
  f.github.intercept(call=>/issues\/20\/comments/.test(call.path) ? {status:503,json:{}} : null);
  f.run(); assert.deepEqual(f.gaps()[0],before);
});
test('shared time budget stops in closing with PASS_STOPPED and no false resolution',()=>{
  const f=fixture(); f.close('pr',20); let clock=0;
  const pass=new state.RefreshBudget({nowMs:()=>clock,budgetMs:600000});
  f.github.intercept(call=>{if(/issues\/20\/comments/.test(call.path)) clock=600001;});
  const result=f.pass(true,pass).run({apply:true});
  assert.ok(result.findings.some(e=>e.code==='PASS_STOPPED' && e.diagnostics.phase==='closing'));
});
test('crash after post before state settlement: retry reads marker and never posts twice',()=>{
  const f=fixture(); f.close('issue',20); f.run(); f.advance(24); let posted=false;
  f.github.intercept(call=>{
    if(call.method==='POST' && call.body?.body?.includes(FACTS)) posted=true;
    if(posted && call.method==='PUT' && /parent-12\.json/.test(call.path)) throw new state.ProgrammeError('STALE_WRITER','Crash fixture.');
  });
  assert.throws(()=>f.run()); assert.equal(f.facts().length,1); f.github.hooks=[]; f.run(); assert.equal(f.facts().length,1);
  assert.ok(!f.parent().pending_effects.some(e=>e.kind==='post_closing_backstop'));
});
test('bots and generated timing branches are excluded from findings and backstops',()=>{
  const f=fixture(); f.close('pr',20,{author:'dependabot[bot]'}); f.close('pr',21,{branch:'toolkit/shard-timings-test'}); f.close('pr',22,{author:'github-actions[bot]'});
  f.run(); f.advance(24); f.run(); assert.equal(f.gaps().length,0); assert.equal(f.facts().length,0);
});
test('finding identity includes item kind; non-holder terminal updates remain refused',()=>{
  const entries=state.foldAttention([],{source:'reconcile',complete:true,now:new Date(START).toISOString(),seen:[
    {code:'CLOSING_COMMENT_MISSING',issue:812,kind:'pr'}, {code:'CLOSING_COMMENT_MISSING',issue:812,kind:'issue'}]});
  assert.equal(entries.length,2); assert.notEqual(entries[0].id,entries[1].id); assert.deepEqual(entries.map(e=>e.kind),['pr','issue']);
  assert.match(state.findingText(entries[0]),/PR #812/); assert.match(state.findingText(entries[1]),/issue #812/);
  const f=fixture(); const child=state.newChild({repository:f.binding.repository,outcome:{issue:20,class:'COMMITTED'}});
  assert.throws(()=>state.applyPatch('child',child,{lifecycle:'DONE'},{writer:{session:'other',prefix:'TEST-'},parentDoc:f.parent()}),{code:'ROLE_REFUSED'});
});
test('72 rows plus thirty closing gaps fit without archive or near-limit warning',t=>{
  const baseline=renderScaleFixture(state);
  assert.deepEqual(baseline.reconciler.run({apply:true}).holds,[]);
  const baseArchives=baseline.github.commentsOf(421).filter(c=>c.body.includes('programme-page-archive')).length;
  const f=renderScaleFixture(state);
  f.parent.attention=state.foldAttention(f.parent.attention,{source:'reconcile',complete:false,now:'2026-11-01T00:00:00Z',seen:
    Array.from({length:30},(_,i)=>({code:'CLOSING_COMMENT_MISSING',issue:3000+i,kind:'pr'}))});
  assert.equal(f.parent.attention.filter(e=>e.code==='CLOSING_COMMENT_MISSING').length,30);
  const projected=f.reconciler.projectBody(421,f.handWritten,state.renderParentBlockBody(f.parent,f.children,f.issues),[],'3.58.0',null,state.renderCurrentBlockBody(f.parent,f.children,f.issues,f.now));
  assert.ok(projected.body.length<57000);
  f.store.mutate('parent',421,{writer:state.refreshWriter(f.parent),change:doc=>({...doc,attention:f.parent.attention})});
  const plan=f.reconciler.plan();
  assert.ok(!plan.findings.some(e=>e.code==='BODY_NEAR_LIMIT'));
  assert.deepEqual(f.reconciler.apply(plan).holds,[]);
  assert.ok(f.github.issues.get(421).body.length<57000);
  const archives=f.github.commentsOf(421).filter(c=>c.body.includes('programme-page-archive')).length;
  assert.equal(archives,baseArchives,'the closing gaps alone create no archive overflow comment');
  assert.ok(!f.store.read('parent',421).doc.attention.some(e=>e.code==='BODY_NEAR_LIMIT'));
  t.diagnostic(`applied_size=${f.github.issues.get(421).body.length}; base_archives=${baseArchives}; closing_gap_archives=${archives-baseArchives}`);
});

test('closing schema, diagnostics and documentation route describe the new command',()=>{
  const Ajv=require('ajv/dist/2020');
  const validate=new Ajv({strict:false}).compile(JSON.parse(fs.readFileSync(path.join(ROOT,'repo/contracts/programme-state/parent-state-v1.schema.json'))));
  const parent=state.newParent({repository:'example.test/app',parentIssue:12});
  parent.attention=state.foldAttention([],{source:'reconcile',complete:true,now:new Date(START).toISOString(),seen:[{code:'CLOSING_COMMENT_MISSING',kind:'pr',issue:20}]});
  assert.equal(parent.attention.length,1); assert.equal(validate(parent),true,JSON.stringify(validate.errors)); assert.deepEqual(state.validateParent(parent),[]);
  delete parent.attention[0].kind; assert.equal(validate(parent),false); assert.ok(state.validateParent(parent).length);
  const doc=fs.readFileSync(path.join(ROOT,'skills/repository-agent-rules/repo-local/docs/agent-playbooks/closing-comments.md'),'utf8');
  for (const phrase of ['closing-comment','stays subscribed','Refs','full SHAs','24 hours','20']) assert.ok(doc.includes(phrase),phrase);
  for(const rel of ['repo/docs/agent-playbooks/INDEX.md','skills/repository-agent-rules/repo-local/docs/agent-playbooks/INDEX.md','skills/github-program-reconciler/SKILL.md','repo/contracts/claude-projects/web-controller-projects/reference/owner-asks.md'])
    assert.match(fs.readFileSync(path.join(ROOT,rel),'utf8'),/closing-comments\.md/);
});
test('merged facts use version at merge, linked issue state, verdicts and deleted branch',()=>{
  const f=fixture(); f.close('pr',20,{branch:'feature/complete'}); f.run(); f.advance(24);
  f.github.intercept(call=>{
    if (call.method==='GET' && call.path.endsWith(`version.json?ref=${SHA}`)) return {status:200,json:{content:Buffer.from('{"version":"3.58.0"}').toString('base64')}};
    if (call.path.endsWith('git/ref/heads/feature%2Fcomplete')) return {status:404,json:{}};
  });
  const owner=f.pass().closing;
  const body=owner.facts(owner.item('pr',20),new Map([[30,{doc:{pr:{number:20},review:{state:'PASSED'},uat:{state:'NOT_REQUIRED'}}}]]));
  assert.match(body,/aaaaaaa.*Version: 3.58.0.*Branch deleted: yes/); assert.match(body,/Refs #12: open/); assert.match(body,/Task 30: G2 PASSED; UAT NOT_REQUIRED/);
});
test('closed facts page events for the closer and issues name a closing PR',()=>{
  const f=fixture(); f.close('pr',20,{merged:false}); f.close('issue',21,{state_reason:'not_planned'});
  f.github.prs.get(20).events=[...Array.from({length:100},()=>({event:'labelled'})),{event:'closed',actor:{login:'fixture-closer'},created_at:f.now()}];
  f.github.intercept(call=>call.path==='graphql' && call.body?.variables?.number===21 ? {status:200,json:{data:{repository:{issue:{closedByPullRequestsReferences:{nodes:[{number:20}]}}}}}}:null);
  f.run(); f.advance(24); f.run();
  assert.match(f.facts().find(c=>c.issue===20).body,/fixture-closer.*reason not recorded/);
  assert.match(f.facts().find(c=>c.issue===21).body,/not planned.*Closing PR: #20/);
});
test('comment paging continues across passes when one item exceeds the planning cap',()=>{
  const f=fixture(); f.close('pr',20);
  for(let n=0;n<6100;n++) f.github.addComment(20,{body:'Conversation.'});
  f.github.addComment(20,{body:STORY});
  const report=f.run(); assert.equal(report.closing.requests,60); assert.equal(report.closing.complete,false);
  assert.match(cli.formatReport(report),/Closing scan: INCOMPLETE.*1 item/);
  assert.equal(f.parent().private.closing_scan[0].page,61);
  f.run(); assert.equal(f.gaps().length,0); assert.deepEqual(f.parent().private.closing_scan,[]);
});
test('command refuses unauthenticated, foreign origins and ambiguous targets before posting',()=>{
  const f=fixture(); f.close('pr',20);
  assert.throws(()=>cli.main(['closing-comment','--pr','20','--body-file','unused'],{transport:f.github,repoRoot:ROOT,originUrl:'https://example.test/foreign/app.git'}),{code:'REPO_IDENTITY_MISMATCH'});
  for(const args of [['closing-comment','--pr','20','--issue','21','--body-file','unused'],['closing-comment','--pr','0','--body-file','unused']]) assert.throws(()=>cli.parseArgs(args),{code:'USAGE'});
  f.github.intercept(call=>call.path==='user' ? {status:401,json:{}}:null);
  assert.throws(()=>f.command('pr',20,'Story.'),{code:'GH_AUTH'});
  assert.equal(f.github.commentsOf(20).length,0);
});
test('a story racing the backstop pre-read prevents the facts post',()=>{
  const f=fixture(); f.close('issue',20); f.run(); f.advance(24);
  const pass=f.pass(), plan=pass.plan();
  f.github.addComment(20,{body:STORY}); pass.apply(plan); assert.equal(f.facts().length,0);
});
test('failed closed issue listing keeps its watermark and preserves its findings',()=>{
  const f=fixture(); f.close('issue',20); f.run(); const before=f.parent().private.graph_issue_watermark;
  f.advance(1); f.close('issue',21);
  f.github.intercept(call=>/issues\?state=closed/.test(call.path) ? {status:503,json:{}}:null);
  const report=f.run(); assert.equal(report.closing.complete,false); assert.equal(f.parent().private.graph_issue_watermark,before); assert.equal(f.gaps().length,1);
  f.github.hooks=[]; f.run(); assert.equal(f.gaps().length,2);
});

test('invalid saved cursors fail closed before any closing item request',()=>{
  const f=fixture();
  f.store.mutate('parent',12,{writer:f.writer,change:doc=>({...doc,private:{...doc.private,closing_scan:[{kind:'pr',number:'../other'}]}})});
  f.github.calls=[]; assert.throws(()=>f.run(),{code:'STATE_INVALID'});
  assert.ok(!f.github.calls.some(call=>/pulls\/\.\./.test(call.path)));
});
test('queue headroom expiry leaves the backstop unposted and records the shared closing stop',()=>{
  const f=fixture(); f.close('issue',20); f.run(); f.advance(24);
  let clock=0;
  const budget=new state.RefreshBudget({nowMs:()=>clock,budgetMs:600000});
  const pass=f.pass(true,budget), plan=pass.plan();
  f.github.intercept(call=>{if(call.method==='GET' && /issues\/20\/comments/.test(call.path)) clock=480001;});
  const result=pass.apply(plan); assert.equal(f.facts().length,0); assert.ok(result.holds.some(e=>e.code==='PASS_STOPPED'));
  assert.equal(budget.stopped.phase,'closing');
});
test('reusing a reconciler resets the comment cap for each new pass',()=>{
  const f=fixture(); for(let n=100;n<250;n++) f.close('pr',n);
  const pass=f.pass(); pass.run({apply:true}); assert.equal(f.gaps().length,60);
  pass.run({apply:true}); assert.equal(f.gaps().length,120);
  pass.run({apply:true}); assert.equal(f.gaps().length,150);
});
