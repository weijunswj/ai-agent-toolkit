'use strict';
const fs=require('node:fs'), path=require('node:path'), crypto=require('node:crypto');
const {StackRegistrySnapshot}=require('../../scripts/toolkit-stack-selection.cjs');
const TEST_PROFILES=Object.freeze({codex:'owner-gpt','claude-code':'owner-claude',opencode:'owner-gpt'});
function capturedStack(profile, registry) {
 const bytes=registry===undefined?fs.readFileSync(path.join(__dirname,'../../contracts/controller-kernel/stack-registry-v3.json')):Buffer.from(JSON.stringify(registry));
 const source_capture={reference:{id:'registry',repository:'synthetic/core-fixture',revision:'fixture-v1',path:'fixture/registry.json',content_sha256:crypto.createHash('sha256').update(bytes).digest('hex'),blob_sha1:null},content_base64:bytes.toString('base64')};
 const snapshot=new StackRegistrySnapshot(source_capture);return {source_capture, selection:snapshot.resolve(profile), snapshot};
}
module.exports={capturedStack,TEST_PROFILES};
