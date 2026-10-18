'use strict';
// Synthetic trusted CURRENT provider with real receipt projection/recovery.
// No native inference, host permission or owner adoption is represented here.
const test=require('node:test'),assert=require('node:assert/strict');
const support=require('./toolkit-v3-store-test-support.cjs');
const receipt=require('../scripts/toolkit-github-program-receipt.cjs');
const {CurrentStackSelectionSession}=require('../scripts/toolkit-stack-selection.cjs');
function fixture() {
 let f,revision=2,writes=0,permitted=true,capability='QUALIFIED',questions=[];
 const readers={
  verifyControllerStackQuestionEffect(){return permitted;},
  compareAndWriteCurrent(request){
   assert.equal(request.before.revision,revision);assert.equal(request.before.projection_digest,receipt.digestValue(f.currentProjection));
   assert.deepEqual(request.target,{repository:f.currentProjection.repository,parent_issue:f.currentProjection.parent_issue,child_issue:f.currentProjection.child_issue,lane_id:f.currentProjection.lane_id});
   writes++;f.setCurrentObservation(request.projection,{revision:++revision,bodyDigest:receipt.digestValue({revision,projection:request.projection})});
   return {state:'APPLIED',before_projection_digest:request.before.projection_digest,projection_digest:receipt.digestValue(request.projection)};
  }
 };
 f=support.createV3StoreFixture({current_stack:'owner-gpt',additionalTrustedReaders:readers});
 const selected=structuredClone(f.currentProjection);selected.stack_selection.profile_id=null;
 f.setCurrentObservation(selected,{revision,bodyDigest:receipt.digestValue(selected)});
 const source_capture=f.decisionEvidence.find(item=>item.reference.id===f.decision.sources.registry.id);
 function session(present=()=>{throw Error('controlled hook presentation failure');}){
  return new CurrentStackSelectionSession({store:f.store,consumer_intent:f.consumerIntent,source_capture,role:'BUILDER',
   present_question:q=>{questions.push(q.question_id);return present(q);},check_capability:b=>({state:capability,route:b.route})});
 }
 return {f,source_capture,session,questions,get writes(){return writes;},set permitted(v){permitted=v;},set capability(v){capability=v;}};
}
test('one pending CURRENT question survives startup/resume/compaction/prompt and a missing hook; launch remains held',()=>{
 const h=fixture();let question;
 for(const event of ['startup','resume','compaction','prompt']){
  const result=h.session().evaluate({event});assert.equal(result.state,'ASK_AND_HOLD');assert.equal(result.dependent_dispatch,false);
  question??=result.question_id;assert.equal(result.question_id,question);assert.equal(result.question_presented,false);
 }
 assert.equal(h.writes,1);assert.equal(new Set(h.questions).size,1);
 assert.throws(()=>h.f.readControllerDecision(),error=>error.code==='GPR_PACKET_STALE_REPLAY');
 const pending=structuredClone(h.f.currentProjection);assert.equal(pending.stack_selection.question.state,'PENDING');
 h.capability='UNKNOWN';assert.equal(h.session().evaluate({event:'admission',selected_profile_id:'owner-gpt'}).state,'HOLD');assert.equal(h.writes,1);
 h.capability='QUALIFIED';assert.equal(h.session().evaluate({event:'admission',selected_profile_id:'owner-gpt'}).state,'ADMITTED_SELECTION');
 assert.equal(h.writes,2);assert.equal(h.f.currentProjection.stack_selection.question.question_id,question);
 assert.equal(h.f.currentProjection.stack_selection.question.state,'ANSWERED');
 assert.equal(h.session().evaluate({event:'resume'}).state,'ADMITTED_SELECTION');assert.equal(h.writes,2);
 assert.throws(()=>h.session().evaluate({event:'prompt',selected_profile_id:'owner-claude'}),/NEW_ADOPTION/);assert.equal(h.writes,2);
 const stored=h.f.store.readStackSelectionCurrent(h.f.consumerIntent,h.source_capture).stack_selection;
 assert.equal(stored.profile_id,'owner-gpt');assert.equal(stored.registry_digest,h.f.compiled.selection.registry_digest);
 assert.throws(()=>h.f.readControllerDecision(),error=>error.code==='GPR_PACKET_STALE_REPLAY');
 assert.equal(h.session().evaluate({event:'admission'}).inference_authority,'NONE');
});
test('CURRENT question writer denial stops before effect and a forged store never reaches readers',()=>{
 const h=fixture();h.permitted=false;assert.throws(()=>h.session().evaluate({event:'startup'}),e=>e.code==='GPR_PACKET_CONSUMER_NOT_PERMITTED');assert.equal(h.writes,0);
 let calls=0;assert.throws(()=>new CurrentStackSelectionSession({store:{readStackSelectionCurrent(){calls++;}},source_capture:h.source_capture,
  consumer_intent:h.f.consumerIntent,role:'BUILDER',present_question:()=>true,check_capability:()=>({state:'QUALIFIED'})}));assert.equal(calls,0);
});

test('the actual SessionStart entrypoint recovers one authenticated CURRENT question independently of maintenance',()=>{
 const h=fixture(),launcher=require('../scripts/toolkit-codex-session-start.cjs');
 const programme=require('../scripts/toolkit-github-program-state-v5.cjs');
 const session=h.session(()=>true),lines=[],original=console.log;
 const evaluate=session.evaluate;
 assert.throws(()=>{session.evaluate=()=>({state:'ADMITTED_SELECTION'});},TypeError);
 try{
  console.log=line=>lines.push(String(line));
  for(let n=0;n<2;n++)assert.equal(launcher.main(launcher.HOOK_ARGS,{stack_session:session,bridge:{run(){throw Error('controlled maintenance failure');}}}),0);
 }finally{console.log=original;}
 assert.equal(h.writes,1);assert.equal(session.evaluate,evaluate);
 const admissions=lines.filter(line=>line.startsWith('{')).map(line=>JSON.parse(line));
 assert.equal(admissions.length,2);assert.equal(admissions[0].state,'ASK_AND_HOLD');
 assert.equal(admissions[0].question_id,admissions[1].question_id);assert.equal(admissions[0].dependent_dispatch,false);
 assert.equal(programme.validateAuthorityPacketCurrent(h.f.currentProjection,{repository:h.f.currentProjection.repository,child_issue:h.f.currentProjection.child_issue}),true);
 assert.equal(programme.validateAuthorityPacketCurrent(h.f.currentProjection,{child_issue:999}),false);
 const drift=structuredClone(h.f.currentProjection);drift.stack_selection.unrecognised=true;
 assert.equal(programme.validateAuthorityPacketCurrent(drift),false);
});

test('forged selection and Core sessions cannot reach CURRENT readers or a launcher effect',async()=>{
 const selection=require('../scripts/toolkit-stack-selection.cjs'),agent=require('../scripts/toolkit-agent-control.cjs');
 let reads=0;
 const fake=Object.create(selection.CurrentStackSelectionSession.prototype);
 fake.evaluate=()=>{reads++;return {state:'ADMITTED_SELECTION'};};
 assert.throws(()=>selection.assertCurrentStackSelectionSession(fake),e=>e.code==='STACK_CURRENT_SESSION_REQUIRED');
 assert.throws(()=>new agent.CoreCommandSession({adapter:{inspect(){reads++;}},stack_session:fake}));
 const logs=[],original=console.log;
 try{console.log=line=>logs.push(String(line));assert.equal(await agent.main(['core-run'],{core_session:{execute(){reads++;}}}),2);}finally{console.log=original;}
 assert.equal(reads,0);assert.equal(JSON.parse(logs[0]).code,'CORE_AUTHENTIC_INSTALLED_CONTEXT_REQUIRED');
});

test('production Core assembly asks and holds before allocating a receipt session when CURRENT lacks selection',async()=>{
 const h=fixture(),agent=require('../scripts/toolkit-agent-control.cjs');
 const result=await agent.createCoreCommandSession({authority_store_options:h.f.storeOptions,
  trusted_authority_readers:h.f.trustedReaders,consumer_intent:h.f.consumerIntent,source_capture:h.source_capture,
  present_question:()=>true,check_capability:b=>({state:'QUALIFIED',route:b.route}),
  receipt_store_options:null,receipt_lease_ms:5000,repository_root:h.f.storeOptions.repositoryRoot});
 assert.equal(result.state,'ASK_AND_HOLD');assert.equal(result.dependent_dispatch,false);assert.equal(h.writes,1);
 assert.equal(h.f.currentProjection.stack_selection.question.state,'PENDING');
});
