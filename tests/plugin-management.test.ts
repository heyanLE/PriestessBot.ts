import assert from 'node:assert/strict';
import {test} from 'node:test';
import {PriestessRuntime} from '../apps/server/src/runtime.js';
import {createRuntimeServer} from '../apps/server/src/http.js';
import {PluginCatalogueSchema,PluginRecordSchema,PluginToolCatalogueSchema} from '../packages/contracts/src/plugins/index.js';
import {SearchStatusSchema,EffectivePromptSchema} from '../packages/contracts/src/search.js';
void test('native plugin management is authenticated, strongly validated and revision safe; secrets never returned',async()=>{
 const runtime=new PriestessRuntime({database:':memory:'});const server=createRuntimeServer(runtime,{token:'plugin-test-token',artifacts:'/tmp/priestess-plugin-test'});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();if(!address||typeof address==='string')throw new Error('No address');const base=`http://127.0.0.1:${address.port}/api/ts/`;
 const request=(route:string,method='GET',body?:unknown)=>fetch(base+route,{method,headers:{Authorization:'Bearer plugin-test-token','Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
 try{
  assert.equal((await fetch(base+'plugins')).status,401);
  const catalogue=PluginCatalogueSchema.parse(await(await request('plugins')).json());assert.equal(catalogue.plugins.length,5);assert.ok(catalogue.plugins.every(p=>!p.record.settings.enabled));
  const tools=PluginToolCatalogueSchema.parse(await(await request('plugins/tools')).json());assert.ok(tools.tools.some(t=>t.id==='qq_group_notices'));assert.ok(tools.tools.some(t=>t.id==='web_search'));
  const enabled=await request('plugins/qq_file','PUT',{expectedRevision:0,settings:{enabled:true}});assert.equal(enabled.status,200);assert.equal(PluginRecordSchema.parse(await enabled.json()).revision,1);
  assert.equal((await request('plugins/qq_file','PUT',{expectedRevision:0,settings:{enabled:false}})).status,409);
  assert.equal((await request('plugins/qq_file','PUT',{expectedRevision:1,settings:{enabled:true,evil:'field'}})).status,400);
  assert.equal((await request('plugins/markdown_killer','PUT',{expectedRevision:0,settings:{enabled:true,timeoutMs:0}})).status,400);
  assert.equal((await request('plugins/bili_video','PUT',{expectedRevision:0,settings:{cookie:'secret'}})).status,400);
  const search=SearchStatusSchema.parse(await(await request('search')).json());assert.equal(search.settings.enabled,false);
  const saved=await request('search','PUT',{...search.settings,revision:undefined,expectedRevision:0,enabled:true});assert.equal(saved.status,200);
  assert.equal((await request('search','PUT',{expectedRevision:0})).status,409);
  const prompt=EffectivePromptSchema.parse(await(await request('agents/assistant/effective-prompt')).json());assert.equal(prompt.source,'inline');assert.ok(prompt.systemPrompt.includes('普瑞赛斯'));
  assert.ok(!(await(await request('plugins')).text()).includes('plugin-test-token'));
 }finally{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));await runtime.stop();}
});
