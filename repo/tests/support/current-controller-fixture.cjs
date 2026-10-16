'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
// Controlled source/authority data only, no native admission or model result.
function currentControllerFixture(profile = 'owner-gpt', registryInput = undefined) {
  const compiler=require('../../scripts/toolkit-gate-contract-compiler.cjs');
  const refs=[],observations=[];
  function ref(id,content={fixture:id}) {
    const bytes=Buffer.from(typeof content==='string'?content:JSON.stringify(content));
    const reference={id,repository:'synthetic/core-fixture',revision:'fixture-v1',path:'fixture/'+id+'.json',content_sha256:crypto.createHash('sha256').update(bytes).digest('hex'),blob_sha1:null};
    refs.push(reference);observations.push({reference,content_base64:bytes.toString('base64')});return reference;
  }
  const source=ref('source'),registry=ref('registry',registryInput === undefined ? fs.readFileSync(path.resolve(__dirname,'../../contracts/controller-kernel/stack-registry-v3.json'),'utf8') : JSON.stringify(registryInput));
  const qualification=Object.fromEntries(compiler.CHEAP_QUALIFIERS.map(key=>[key,{status:'UNKNOWN',source:null}]));
  const {StackRegistrySnapshot}=require('../../scripts/toolkit-stack-selection.cjs');
  const captured=new StackRegistrySnapshot(observations.find(o=>o.reference.id===registry.id));
  const resolved=compiler.resolveContinuousProfile(profile,qualification,captured),routes=resolved.routes;
  const runner={id:'CORE_DATA_SUITE',executable:process.execPath,argv:['--test','repo/tests/toolkit-core-redesign-contract.test.cjs'],cwd:path.resolve(__dirname,'../../..')};
  const decision={schema:'toolkit.controller-decision.v2',identity:{repository:'synthetic/core-fixture',programme:1,child:2,stable_root:'fixture-root',run:'fixture-run',lock:'fixture-lock',revision:1,supersedes:null},
    sources:{authority:source,controller:source,architecture:source,registry,requirements:[source],base:{commit:'1'.repeat(40),tree:'2'.repeat(40)},custody:[source]},
    selection:{registry_version:3,profile_id:profile,builder_qualification:qualification,routes,reviewers:resolved.reviewers,registry_digest:resolved.registry_digest,discovery_bound:0,helper_bound:0,helper_depth:1},
    assurance:{policy:'continuous-builder-v1',risk_classification:source,design_challenge_required:false,design_challenge:null,g3_review:'BUILDER_VALIDATION',inherited_reviews:[],candidate_review:'FRESH_INDEPENDENT_EXACT_CANDIDATE',final_audit:'SEPARATE_PROGRAMME_FINAL_AUDIT'},
    authority:{approval:source,operations:['READ'],targets:['repo/fixture.md'],effect_ceiling:{source_writes:0,validation_invocations:0,helper_launches:0,native_turns:0,candidate_submissions:0},lifetime:'EXPLICIT_EXPIRY',issued_at:'2026-01-01T00:00:00Z',expires_at:'2027-01-01T00:00:00Z',revocations:[],successor_fit:source},
    accounting:{stable_root:'fixture-root',grant_id:'fixture-grant',first_admission_id:'fixture-first-admission',debt:{kind:'AT_LEAST',count:6,unknown_additional:true},events:[],grant:source,remaining:{construction_cycles:1,correction_cycles:0,candidates:0,helpers:0,native_turns:0},history_certificates:[source]},
    construction:{allow_paths:['repo/fixture.md'],restrictions:[{path:'repo/fixture.md',restriction:'Synthetic source-only'}],releases:[source],base:{commit:'1'.repeat(40),tree:'2'.repeat(40)},candidate_ceiling:0},
    verification:{requirements:['K01'],cases:['NEGATIVE','POSITIVE'].map(kind=>({id:'fixture-'+kind,requirement:'K01',boundary:'data',kind,runner,max_invocations:2,timeout_ms:1000,output_paths:['fixture-output'],source})),trusted_producers:[source],effect_oracles:['data-only'],required_consumers:['CORE_DATA_TEST']},
    recovery:{custody:[source],unresolved_dispatches:[],unresolved_effects:[],unresolved_publications:[],next_action:'HOLD_NATIVE_PROOF'}};
  return {decision,observations,source,refs,captured};
}

module.exports={currentControllerFixture};
