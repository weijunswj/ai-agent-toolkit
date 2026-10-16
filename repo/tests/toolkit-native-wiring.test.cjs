'use strict';const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const plugin=require('../scripts/toolkit-opencode-project-plugin.cjs'),codex=require('../scripts/toolkit-codex-agent-adapter.cjs');

test('installed V1 export enumerator discovers js and registers the default/named factory once',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'toolkit-v1-native-loader-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const operation=plugin.installProjectPlugin||plugin.install;assert.equal(typeof operation,'function','real project registration operation exported');
 const result=operation({projectRoot:root,write:true,generation:'V1'});const file=path.join(root,'.opencode/plugins/ai-agent-toolkit.js');assert.ok(fs.existsSync(file));
 const exports=await import(require('node:url').pathToFileURL(file).href);const factories=[],seen=new Set;for(const value of Object.values(exports)){if(seen.has(value))continue;seen.add(value);assert.equal(typeof value,'function');factories.push(value);}assert.equal(factories.length,1);
 const calls=[],ctx={client:{session:{get:async args=>{calls.push(args);return{data:{id:'root'}}}},app:{agents:async()=>({data:[]})}}};const hooks=await factories[0](ctx);await hooks['chat.params']({sessionID:'root'},{});assert.deepEqual(calls,[{path:{id:'root'}}]);assert.equal(typeof hooks['tool.execute.before'],'function');assert.equal(typeof hooks['chat.headers'],'function');
 await assert.rejects(factories[0]({}),/SESSION_OBSERVER_UNAVAILABLE/);assert.equal(fs.existsSync(path.join(root,'.opencode/plugins/ai-agent-toolkit.mjs')),false);
});

test('actual public V2 unavailable pre-dispatch invariant cannot be satisfied by a controlled tool.hook object',()=>{
 assert.throws(()=>plugin.renderPluginPayload('V2'),/V2_PRE_DISPATCH_API_UNAVAILABLE/);
 const template=fs.readFileSync(path.join(__dirname,'../contracts/toolkit-local-bridge/opencode-plugin/ai-agent-toolkit.mjs'),'utf8');assert.doesNotMatch(template,/ctx\.tool\.hook/);assert.match(template,/V2_PRE_DISPATCH_API_UNAVAILABLE/);
});

test('supported owned Codex dynamic helper remains offered to both leads but not leaves or reviewers',()=>{
 for(const role of ['DISCOVERY','BUILDER']){assert.ok(codex.toolDefinitions(role).some(t=>t.name==='toolkit_request_helper'));assert.equal(codex.toolDefinitionForRole(role,false,'toolkit_request_helper').name,'toolkit_request_helper');assert.throws(()=>codex.toolDefinitionForRole(role,true,'toolkit_request_helper'),/CORE_TOOL_FORBIDDEN/);}
 for(const role of ['DISCOVERY_HELPER','BUILDER_HELPER','REVIEW']){assert.equal(codex.toolDefinitions(role).some(t=>t.name==='toolkit_request_helper'),false);assert.throws(()=>codex.toolDefinitionForRole(role,false,'toolkit_request_helper'),/CORE_TOOL_FORBIDDEN/);}
 assert.throws(()=>codex.toolDefinitionForRole('DISCOVERY',false,'toolkit_apply_patch'),/CORE_TOOL_FORBIDDEN/);assert.throws(()=>codex.toolDefinitionForRole('unbound',false,'toolkit_read'),/CORE_TOOL_FORBIDDEN/);
});
