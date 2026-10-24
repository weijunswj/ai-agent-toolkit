'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),test=require('node:test');
const {capturedStack}=require('./support/captured-stack-fixture.cjs');
const {CapturedStackBinding}=require('../scripts/toolkit-stack-selection.cjs');
const root=path.resolve(__dirname,'../..'),document=fs.readFileSync(path.join(root,'repo/CONTROLLER.md'),'utf8');
function current(text){assert.equal(text.includes('## Historical compatibility reference'),false,'the pre-V3 history is removed');return text;}

test('current procedure resolves all concrete routes solely from captured registry and CURRENT',()=>{
 const body=current(document);assert.match(body,/canonical \[V3 stack registry\]\(contracts\/controller-kernel\/stack-registry-v3\.json\)/);assert.match(body,/exact captured registry revision and pinned CURRENT selection/);assert.match(body,/sole source of concrete model, effort and required reviewer choices/);
 for(const role of ['DISCOVERY','DISCOVERY_HELPER','BUILDER','BUILDER_HELPER','DESIGN_CHALLENGE'])assert.ok(body.includes(role),role);
 const registry=JSON.parse(fs.readFileSync(path.join(root,'repo/contracts/controller-kernel/stack-registry-v3.json')));
 for(const p of Object.values(registry.profiles))for(const r of [...Object.values(p.routes),...p.reviewers])if(r)assert.equal(body.includes(r.model),false,'current Controller cannot duplicate '+r.model);
 assert.doesNotMatch(body,/Sol\s+\d|Opus\s+\d|Haiku\s+\d|Luna\s+(?:High|Max)|Astra\s+(?:High|Max)/);assert.match(body,/do not.*use a default\/fallback selection/);
});

test('current complete independent review law applies to the actual selected 1\/1 member sets',()=>{
 const body=current(document);assert.match(body,/entire required reviewers set/);assert.match(body,/Every selected required reviewer gets the identical complete candidate, scope and evidence/);assert.match(body,/independently reviews the complete agreed acceptance surface/);assert.match(body,/Do not split scope-only and execution-only assignments, enforce a fixed reviewer count, omit a required member, or copy another Claude review/);assert.doesNotMatch(body,/use two fresh independent peers|uses two independent Opus|scope\/correctness and Astra|Initial broad G2 uses two/);
 const registry=JSON.parse(fs.readFileSync(path.join(root,'repo/contracts/controller-kernel/stack-registry-v3.json')));
 for(const [id,count]of [['owner-gpt',1],['owner-claude',1]]){const capture=capturedStack(id),owner=new CapturedStackBinding(capture),members=owner.selection.reviewers;assert.equal(members.length,count);assert.deepEqual(members,registry.profiles[id].reviewers);assert.equal(new Set(members.map(m=>m.reviewer_id)).size,count);for(const member of members){const result=owner.role('REVIEW',member.reviewer_id);const {reviewer_id,...route}=member;assert.deepEqual(result.route,route);assert.equal(result.reviewer_id,reviewer_id);assert.equal(result.registry_digest,owner.sourceDigest);}assert.throws(()=>owner.role('REVIEW','not-required'),{code:'STACK_REVIEWER_UNADMITTED'});}
 assert.match(body,/conditional design challenge resolves the separate DESIGN_CHALLENGE/);assert.match(body,/neither replaces a required reviewer nor becomes a routine extra role/);
});

test('native verification preserves exact supported configuration and scoped historical overrides',()=>{
 const body=current(document);assert.match(body,/verify the supported actual route and exact effective configuration before consequential effects/i);assert.match(body,/read once before consequential work, is the route proof, never the model's self-report/);assert.match(body,/a host that keeps no record is recorded as not checkable/);assert.match(body,/post one takeover record, one line, on the parent's CURRENT when ENABLED, else in the evidence store/);assert.match(body,/No unavailable route authorises a model\/effort\/provider fallback/);assert.match(body,/Admitted historical qualification overrides retain their exact scoped authority and immutable inputs/);assert.match(body,/Source tests.*cannot establish native qualification/);assert.doesNotMatch(body,/selected native qualification bindings are/);
});

test('actual bootstrap consumer references exact Controller and version-bound registry sources',()=>{
 const skill=fs.readFileSync(path.join(root,'skills/controller-bootstrap/SKILL.md'),'utf8');assert.match(skill,/`controller`: `repo\/CONTROLLER\.md`/);assert.match(skill,/stack-registry-v3\.json.*explicitly admitted continuous profiles/s);assert.match(skill,/complete returned bytes against both Git blob SHA-1 and content SHA-256/);assert.match(skill,/must not self-verify root admission/);
});

test('the Architecture file is a pointer-only map, and the bootstrap no longer pins it',()=>{
 const architecture=fs.readFileSync(path.join(root,'repo/ARCHITECTURE.md'),'utf8');assert.match(architecture,/^# Toolkit Repository Map/);assert.doesNotMatch(architecture,/sole source of concrete model|Every selected required reviewer|selected native qualification bindings are/);const registry=JSON.parse(fs.readFileSync(path.join(root,'repo/contracts/controller-kernel/stack-registry-v3.json')));for(const p of Object.values(registry.profiles))for(const r of [...Object.values(p.routes),...p.reviewers])if(r)assert.equal(architecture.includes(r.model),false);const skill=fs.readFileSync(path.join(root,'skills/controller-bootstrap/SKILL.md'),'utf8');assert.doesNotMatch(skill,/ARCHITECTURE.md/);
});
