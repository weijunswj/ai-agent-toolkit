'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),test=require('node:test');
const {capturedStack}=require('./support/captured-stack-fixture.cjs');
const {controllerText}=require('./support/controller-text.cjs');
const {CapturedStackBinding}=require('../scripts/toolkit-stack-selection.cjs');
const root=path.resolve(__dirname,'../..'),document=controllerText();
function current(text){assert.equal(text.includes('## Historical compatibility reference'),false,'the pre-V3 history is removed');return text;}

test('current procedure resolves all concrete routes solely from captured registry and CURRENT',()=>{
 const body=current(document);assert.match(body,/canonical \[stack registry\]\(\.\.\/contracts\/controller-kernel\/stack-registry-v3\.json\)/);assert.match(body,/exact captured registry revision and pinned CURRENT selection/);assert.match(body,/Model, effort and reviewer choices come only from it/);
 assert.equal(body.includes('GATEKEEPER'),false,'the gatekeeper is a tier rule, not a registry role');for(const role of ['DISCOVERY','DISCOVERY_HELPER','BUILDER','BUILDER_HELPER','DESIGN_CHALLENGE'])assert.ok(body.includes(role),role);
 const registry=JSON.parse(fs.readFileSync(path.join(root,'repo/contracts/controller-kernel/stack-registry-v3.json')));
 for(const p of Object.values(registry.profiles))for(const r of [...Object.values(p.routes),...p.reviewers])if(r)assert.equal(body.includes(r.model),false,'current Controller cannot duplicate '+r.model);
 assert.doesNotMatch(body,/Sol\s+\d|Opus\s+\d|Haiku\s+\d|Luna\s+(?:High|Max)|Astra\s+(?:High|Max)/);assert.match(body,/never infer helpers from leads or use defaults\/fallbacks/);
});

test('current complete independent review law applies to the actual selected 1\/1 member sets',()=>{
 const body=current(document);assert.match(body,/Resolve the full reviewer set from the same selection/);assert.match(body,/each independently reviews the identical complete candidate, scope and evidence/);assert.match(body,/correctness, execution, authority, privacy, recovery/);assert.match(body,/Never split scope\/execution assignments, enforce a fixed count, omit members or copy another review as independent evidence/);assert.doesNotMatch(body,/use two fresh independent peers|uses two independent Opus|scope\/correctness and Astra|Initial broad G2 uses two/);
 const registry=JSON.parse(fs.readFileSync(path.join(root,'repo/contracts/controller-kernel/stack-registry-v3.json')));
 for(const [id,count]of [['owner-gpt',1],['owner-claude',1]]){const capture=capturedStack(id),owner=new CapturedStackBinding(capture),members=owner.selection.reviewers;assert.equal(members.length,count);assert.deepEqual(members,registry.profiles[id].reviewers);assert.equal(new Set(members.map(m=>m.reviewer_id)).size,count);for(const member of members){const result=owner.role('REVIEW',member.reviewer_id);const {reviewer_id,...route}=member;assert.deepEqual(result.route,route);assert.equal(result.reviewer_id,reviewer_id);assert.equal(result.registry_digest,owner.sourceDigest);}assert.throws(()=>owner.role('REVIEW','not-required'),{code:'STACK_REVIEWER_UNADMITTED'});}
 assert.match(body,/DESIGN_CHALLENGE is only for unresolved consequential design risk/);assert.match(body,/never a reviewer replacement or routine extra role/);
});

test('native verification preserves exact supported configuration and scoped historical overrides',()=>{
 const body=current(document);assert.match(body,/Verify actual route\/effective config before effects/);assert.match(body,/Read the host's launch record \(init event\/session metadata\) once before consequential work, never self-report/);assert.match(body,/inherited, missing or mismatched model\/effort refuses start/);assert.match(body,/With no host record, record "not checkable on this host"/);assert.match(body,/post one takeover record, one line, on the parent's CURRENT when ENABLED, else in the evidence store/);assert.match(body,/No unavailable route authorises a model\/effort\/provider fallback/);assert.match(body,/Historical qualification overrides keep exact scope\/immutable inputs/);assert.match(body,/Source tests.*cannot establish native qualification/);assert.doesNotMatch(body,/selected native qualification bindings are/);
});

test('actual bootstrap consumer references exact Controller and version-bound registry sources',()=>{
 const skill=fs.readFileSync(path.join(root,'skills/controller-bootstrap/SKILL.md'),'utf8');assert.match(skill,/`controller`: `repo\/CONTROLLER\.md`/);assert.match(skill,/stack-registry-v3\.json.*explicitly admitted continuous profiles/s);assert.match(skill,/complete returned bytes against both Git blob SHA-1 and content SHA-256/);assert.match(skill,/must not self-verify root admission/);
});

test('the Architecture file is a pointer-only map, and the bootstrap no longer pins it',()=>{
 const architecture=fs.readFileSync(path.join(root,'repo/ARCHITECTURE.md'),'utf8');assert.match(architecture,/^# Toolkit Repository Map/);assert.doesNotMatch(architecture,/sole source of concrete model|Every selected required reviewer|selected native qualification bindings are/);const registry=JSON.parse(fs.readFileSync(path.join(root,'repo/contracts/controller-kernel/stack-registry-v3.json')));for(const p of Object.values(registry.profiles))for(const r of [...Object.values(p.routes),...p.reviewers])if(r)assert.equal(architecture.includes(r.model),false);const skill=fs.readFileSync(path.join(root,'skills/controller-bootstrap/SKILL.md'),'utf8');assert.doesNotMatch(skill,/ARCHITECTURE.md/);
});

test('route proof still refuses a headless run and coordinators never take a gate verdict', () => {
  const body = current(document);
  assert.match(body, /never self-report or a headless run/);
  assert.match(body, /Exception: the gatekeeper may start the other harness's gate through that tool's CLI/);
  assert.match(body, /Coordinators\/non-gate threads relay, never take a gate's verdict\./);
  assert.doesNotMatch(body, /relay, never judge\./);
});
