'use strict';
// Explicit original pinned source bytes for historical V1/IR2 compatibility.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {StackRegistrySnapshot}=require('../../scripts/toolkit-stack-selection.cjs');
const compiler=require('../../scripts/toolkit-gate-contract-compiler.cjs');
const originalBytes=fs.readFileSync(path.join(__dirname,'../fixtures/stack-registry-v3-historical.json'));
function historicalStack(profile,registry) {
 const bytes=registry===undefined?originalBytes:Buffer.from(JSON.stringify(registry));
 const source_capture={reference:{id:'registry',repository:'synthetic/core-fixture',revision:'original-pinned-historical-fixture',path:'fixture/registry.json',content_sha256:crypto.createHash('sha256').update(bytes).digest('hex'),blob_sha1:null},content_base64:bytes.toString('base64'),historical:true};
 const snapshot=new StackRegistrySnapshot(source_capture);return {snapshot,source_capture,selection:snapshot.resolve(profile,{historical:true})};
}
function resolveHistorical(profile,qualification,registry){return compiler.resolveContinuousProfile(profile,qualification,historicalStack(profile,registry).snapshot,{historical:true});}
function historicalControllerFixture(){
 const fixture=require('./current-controller-fixture.cjs').currentControllerFixture();
 const captured=historicalStack('owner-openai-continuous-v1'),observation=fixture.observations.find(o=>o.reference.id==='registry');
 observation.reference=captured.source_capture.reference;observation.content_base64=captured.source_capture.content_base64;
 fixture.decision.schema='toolkit.controller-decision.v1';fixture.decision.sources.registry=observation.reference;
 fixture.decision.selection.profile_id=captured.selection.profile_id;fixture.decision.selection.routes=captured.selection.routes;
 delete fixture.decision.selection.reviewers;delete fixture.decision.selection.registry_digest;fixture.captured=captured.snapshot;return fixture;
}
module.exports={historicalStack,resolveHistorical,historicalControllerFixture,originalRegistry:JSON.parse(originalBytes)};
