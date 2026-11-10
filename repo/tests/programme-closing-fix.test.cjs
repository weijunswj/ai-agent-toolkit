'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '../..');
const state = require('../../skills/github-program-reconciler/scripts/programme-state.cjs');
const cli = require('../../skills/github-program-reconciler/scripts/programme.cjs');
const { pageFixture } = require('./support/programme-page-fixture.cjs');
const SHA = 'a'.repeat(40), FACTS = '<!-- toolkit-closing kind=facts -->';

function fixture() {
  const f = pageFixture(state);
  let time = Date.parse('2026-11-09T00:00:00Z');
  const now = () => new Date(time).toISOString();
  f.store.now = now;
  const pass = budget => new state.Reconciler({ binding:f.binding, store:f.store, writer:state.refreshWriter(f.parent()),
    refreshFacts:true, now, toolkitVersion:'3.59.0', pass:budget,
    reader:new state.ProgrammeGraphReader({transport:f.github,repository:f.binding.repository}),
    mutator:new state.GitHubMutator({transport:f.github,repository:f.binding.repository}) });
  const run = () => pass().run({apply:true});
  const advance = hours => {time += hours*3600000; f.github.clock=time;};
  const close = (kind, number, options = {}) => {
    if(kind === 'pr') {
      f.github.addPr(number,{head:SHA,state:'CLOSED',merged:true,mergedAt:now(),body:'Refs #12'});
      Object.assign(f.github.prs.get(number),{closedAt:now(),updated_at:now(),...options});
    } else Object.assign(f.github.addIssue(number,{state:'closed'}),{closed_at:now(),updated_at:now(),state_reason:'completed',...options});
  };
  run(); advance(1);
  return {...f,pass,run,advance,close,now,
    gaps:()=>f.parent().attention.filter(e=>e.code==='CLOSING_COMMENT_MISSING' && ['new','acknowledged'].includes(e.state)),
    facts:()=>[...f.github.comments.values()].filter(c=>c.body.includes(FACTS))};
}

test('fix M1: twenty unreadable or PR references cannot starve the twenty-first due post',()=>{
  const f=fixture();
  f.github.addPr(90,{head:SHA,state:'CLOSED',merged:true});
  f.github.prs.get(90).author='dependabot[bot]';
  for(let n=100;n<121;n++) f.close('pr',n,{body:n===120 ? 'Refs #12' : n%2 ? 'Refs #999' : 'Refs #90'});
  f.run(); assert.equal(f.gaps().length,21); f.advance(24);
  f.run(); assert.equal(f.facts().length,20);
  f.run(); assert.equal(f.facts().length,21);
  assert.equal(new Set(f.facts().map(c=>c.issue)).size,21);
  for(const c of f.facts().filter(c=>c.issue!==120)) assert.match(c.body,/Refs #(90|999): not readable/);
  f.run(); assert.equal(f.facts().length,21);
});

test('fix M1: a facts preparation failure frees its slot for the next due item',()=>{
  const f=fixture(); for(let n=100;n<121;n++) f.close('pr',n);
  f.run(); f.advance(24);
  const pass=f.pass(), original=pass.closing.facts.bind(pass.closing);
  pass.closing.facts=(item,children)=>{if(item.number===120) throw new state.ProgrammeError('CLOSING_INCOMPLETE','Fixture unreadable facts.'); return original(item,children);};
  pass.run({apply:true}); assert.equal(f.facts().length,20); assert.ok(f.facts().some(c=>c.issue===100));
  f.run(); assert.equal(f.facts().length,21);
});

test('fix M1: unreadable linked issues are facts, while a shared time stop still stops',()=>{
  for(const status of [403,404,503]) {
    const f=fixture(); f.close('pr',20,{body:'Refs #999'});
    f.github.intercept(call=>call.path.endsWith('/issues/999') ? {status,json:{}} : null);
    const owner=f.pass().closing;
    assert.match(owner.facts(owner.item('pr',20),new Map()),/Refs #999: not readable/);
  }
  const f=fixture(); f.close('pr',20,{body:'Refs #999'});
  f.github.intercept(call=>{if(call.path.endsWith('/issues/999')) throw new state.ProgrammeError('PASS_STOPPED','Fixture time stop.');});
  const owner=f.pass().closing;
  assert.throws(()=>owner.facts(owner.item('pr',20),new Map()),{code:'PASS_STOPPED'});
});

test('fix M2: the fake defaults to open references; facts include closed PRs and prefer merged',()=>{
  const f=fixture(); f.close('issue',20);
  f.github.addPr(30,{head:SHA,state:'OPEN'}); f.github.addPr(31,{head:SHA,state:'CLOSED'}); f.github.addPr(32,{head:SHA,state:'CLOSED',merged:true});
  f.github.issuePrLinks.set(20,{closing:[30,31,32]});
  const query='query{repository{ i20: issue(number: 20){closedByPullRequestsReferences(first:100){nodes{number state merged}}}}}';
  assert.deepEqual(f.github.graphql(query,{}).repository.i20.closedByPullRequestsReferences.nodes.map(n=>n.number),[30]);
  const owner=f.pass().closing;
  assert.match(owner.facts(owner.item('issue',20),new Map()),/Closing PR: #32/);
  assert.match(f.github.calls.at(-1).body.query,/includeClosedPrs:\s*true/);
});

test('fix M2: GraphQL errors or missing data never become recorded closing PRs',()=>{
  const f=fixture(); f.close('issue',20);
  const owner=f.pass().closing, item=owner.item('issue',20);
  for(const response of [
    {status:200,json:{errors:[{message:'Fixture failure'}],data:{repository:{issue:{closedByPullRequestsReferences:{nodes:[{number:30,state:'MERGED',merged:true}]}}}}}},
    {status:200,json:{data:{repository:{issue:null}}}},
    {status:503,json:{}},
  ]) {
    f.github.hooks=[]; f.github.intercept(call=>call.path==='graphql' ? response : null);
    assert.match(owner.facts(item,new Map()),/Closing PR: not recorded/);
  }
});

test('fix M3: reopen clears cursors and gaps, and a later close gets a fresh 24 hours',()=>{
  for(const kind of ['issue','pr']) {
    const f=fixture(); f.close(kind,20); f.run(); const first=f.gaps()[0].first_seen;
    f.store.mutate('parent',12,{writer:f.writer,change:doc=>({...doc,private:{...doc.private,closing_scan:[{kind,number:20,closed_at:f.now()}]}})});
    f.advance(25);
    const raw=kind==='pr' ? f.github.prs.get(20) : f.github.issues.get(20);
    Object.assign(raw,kind==='pr' ? {state:'OPEN',merged:false,mergedAt:null,closedAt:null,updated_at:f.now()} : {state:'open',closed_at:null,updated_at:f.now()});
    const report=f.run(); assert.equal(f.gaps().length,0); assert.deepEqual(f.parent().private.closing_scan,[]);
    assert.equal(report.closing.complete,true); assert.doesNotMatch(cli.formatReport(report),/Closing scan: INCOMPLETE/);
    f.advance(1); f.close(kind,20); f.run();
    assert.equal(f.gaps().length,1); assert.notEqual(f.gaps()[0].first_seen,first); assert.equal(f.gaps()[0].first_seen,f.now());
    assert.equal(f.facts().length,0); f.advance(23); f.run(); assert.equal(f.facts().length,0);
    f.advance(1); f.run(); assert.equal(f.facts().length,1);
  }
});

test('fix L3: a stop after observation reports planning rather than closing',()=>{
  const f=fixture(); let clock=0;
  const budget=new state.RefreshBudget({nowMs:()=>clock,budgetMs:600000});
  const pass=f.pass(budget), observe=pass.observe.bind(pass);
  pass.observe=(...args)=>{const result=observe(...args); clock=600001; return result;};
  const report=pass.run({apply:true});
  assert.ok(report.findings.some(e=>e.code==='PASS_STOPPED' && e.diagnostics.phase==='planning'));
});

test('fix L4: only a same-repository branch 404 means deleted',()=>{
  for(const [headRepository,status,expected] of [
    ['example.test/app',404,'yes'], ['EXAMPLE.TEST/APP',200,'no'], ['example.test/fork',404,'not recorded'],
    [null,404,'not recorded'], ['example.test/app',403,'not recorded'], ['example.test/app',503,'not recorded'],
  ]) {
    const f=fixture(); f.close('pr',20,{branch:'feature/done',headRepository});
    // Model the REST head repository independently of the shared fake, including on the old source.
    f.github.intercept(call=>{
      if(call.path.endsWith('/pulls/20')) {const response=f.github.route(call.method,call.path,call.body); response.json.head.repo=headRepository ? {full_name:headRepository} : null; return response;}
      if(call.path.includes('/git/ref/')) return {status,json:{}};
    });
    const owner=f.pass().closing;
    assert.match(owner.facts(owner.item('pr',20),new Map()),new RegExp(`Branch deleted: ${expected}\\.`));
    if(!headRepository || headRepository.toLowerCase()!==f.binding.repository) assert.ok(!f.github.calls.some(c=>c.path.includes('/git/ref/')));
  }
});

test('fix L6: closing tests use OS temp and neither suite retains the builder override',()=>{
  const closing=fs.readFileSync(path.join(__dirname,'programme-closing-comments.test.cjs'),'utf8');
  const authority=fs.readFileSync(path.join(__dirname,'toolkit-programme-authority.test.cjs'),'utf8');
  assert.doesNotMatch(closing+authority,/A2B_SOURCE_ROOT/);
  assert.doesNotMatch(closing,/path\.resolve\('\.tmp\/a2b-report'\)/);
  assert.match(closing,/mkdtempSync/); assert.match(closing,/tmpdir\(\)/); assert.match(closing,/after\(/);
});

test('fix L7: playbook discovery and Projects point to a checkout or Remote Control',()=>{
  const skill=fs.readFileSync(path.join(ROOT,'skills/repository-agent-rules/SKILL.md'),'utf8');
  assert.match(skill.split('\n').find(line=>line.includes('every Markdown file:')),/`closing-comments\.md`/);
  const pointer=fs.readFileSync(path.join(ROOT,'repo/contracts/claude-projects/web-controller-projects/reference/owner-asks.md'),'utf8').split('\n').find(line=>line.includes('closing-comments.md'));
  assert.match(pointer,/checkout/); assert.match(pointer,/Remote Control/);
});

test('fix L7: mismatched command flags name the correct target kind',t=>{
  const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'closing-flags-')); t.after(()=>fs.rmSync(scratch,{recursive:true,force:true}));
  const file=path.join(scratch,'story.txt'); fs.writeFileSync(file,'Story.');
  const f=fixture(); f.close('pr',20); f.close('issue',21);
  for(const [flag,number,correct] of [['issue',20,'pr'],['pr',21,'issue']])
    assert.throws(()=>cli.main(['closing-comment',`--${flag}`,String(number),'--body-file',file],
      {transport:f.github,repoRoot:ROOT,originUrl:'https://github.com/example.test/app.git',stdout:{write(){}}}),
    e=>e.code==='CLOSING_KIND_MISMATCH' && e.message.includes(`--${correct} ${number}`));
});
