'use strict';const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const plugin=require('../scripts/toolkit-opencode-project-plugin.cjs'),codex=require('../scripts/toolkit-codex-agent-adapter.cjs');

test('installed V1 export enumerator discovers js and registers the default/named factory once',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'toolkit-v1-native-loader-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const operation=plugin.installProjectPlugin||plugin.install;assert.equal(typeof operation,'function','real project registration operation exported');
 const result=operation({projectRoot:root,write:true,generation:'V1'});const file=path.join(root,'.opencode/plugins/ai-agent-toolkit.js');assert.ok(fs.existsSync(file));
 const exports=await import(require('node:url').pathToFileURL(file).href);const factories=[],seen=new Set;for(const value of Object.values(exports)){if(seen.has(value))continue;seen.add(value);assert.equal(typeof value,'function');factories.push(value);}assert.equal(factories.length,1);
 const calls=[],ctx={client:{session:{get:async args=>{calls.push(args);return{data:{id:'root'}}}},app:{agents:async()=>({data:[]})}}};const hooks=await factories[0](ctx);await hooks['chat.params']({sessionID:'root'},{});assert.deepEqual(calls,[{path:{id:'root'}}]);assert.equal(typeof hooks['tool.execute.before'],'function');assert.equal(typeof hooks['chat.headers'],'function');
 // A factory that threw would leave the native task tool unguarded; missing observers hold task instead.
 const held=await factories[0]({});await assert.rejects(held['tool.execute.before']({tool:'task',sessionID:'root'},{args:{}}),/OPENCODE_SESSION_OBSERVER_UNAVAILABLE/);
 assert.equal(await held['tool.execute.before']({tool:'read',sessionID:'root'},{args:{}}),undefined);
 await assert.rejects(held['chat.params']({sessionID:'child'},{}),/OPENCODE_SESSION_OBSERVER_UNAVAILABLE/,'an unobservable session is treated as a helper child');
 assert.equal(fs.existsSync(path.join(root,'.opencode/plugins/ai-agent-toolkit.mjs')),false);
});

test('the installed V1 plugin pins its helper runtime and holds task when that runtime is missing or drifted',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'toolkit-v1-runtime-pins-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 plugin.installProjectPlugin({projectRoot:root,write:true,generation:'V1'});const file=path.join(root,'.opencode/plugins/ai-agent-toolkit.js'),bytes=fs.readFileSync(file,'utf8');
 const pins=plugin.helperRuntimePins();assert.ok(Object.keys(pins).some(f=>f.endsWith('toolkit-v3-native-helper-adapter.cjs')));assert.ok(Object.keys(pins).some(f=>f.endsWith('toolkit-v3-helper-guard.cjs')));
 assert.ok(bytes.includes(JSON.stringify(pins)),'the rendered plugin carries the exact runtime pins');
 const ctx={client:{session:{get:async({path:{id}})=>({data:{id,parentID:id==='child'?'root':undefined}})},app:{agents:async()=>({data:[]})}}};
 const variant=async(name,text)=>{const target=path.join(root,'.opencode/plugins',name);fs.writeFileSync(target,text);const m=await import(require('node:url').pathToFileURL(target).href);return m.default(ctx);};
 // Same boundary, intact runtime: the guard itself decides (no launcher binding here).
 const intact=await variant('intact.js',bytes);await assert.rejects(intact['tool.execute.before']({tool:'task',sessionID:'root'},{args:{}}),/NATIVE_BINDING_REQUIRED/);
 const [first]=Object.keys(pins);
 const drifted=await variant('drifted.js',bytes.replace(pins[first],'0'.repeat(64)));
 await assert.rejects(drifted['tool.execute.before']({tool:'task',sessionID:'root'},{args:{}}),/OPENCODE_HELPER_RUNTIME_DRIFT/);
 assert.equal(await drifted['tool.execute.before']({tool:'read',sessionID:'root'},{args:{}}),undefined);
 assert.equal(await drifted['chat.params']({sessionID:'root'},{}),undefined,'root sessions stay usable');
 await assert.rejects(drifted['chat.params']({sessionID:'child'},{}),/OPENCODE_HELPER_RUNTIME_DRIFT/);
 const missing=await variant('missing.js',bytes.replace(JSON.stringify(first),JSON.stringify(path.join(root,'absent-module.cjs'))));
 await assert.rejects(missing['tool.execute.before']({tool:'task',sessionID:'root'},{args:{}}),/OPENCODE_HELPER_RUNTIME_MISSING/);
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
