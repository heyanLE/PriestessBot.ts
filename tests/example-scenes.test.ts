import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {ExampleDialogsSchema} from '../packages/contracts/src/index.js';
import {exampleScenes} from '../packages/contracts/src/example-scenes.js';
import {PersonaInputSchema} from '../packages/contracts/src/management.js';
void test('legacy pairs stay separate while scene markers preserve multi-turn boundaries',()=>{
 const pair=[{role:'user',content:'hi'},{role:'assistant',content:'hello'}];const legacy=ExampleDialogsSchema.parse([...pair,...pair]);assert.deepEqual(exampleScenes(legacy).map(s=>[s.start,s.end]),[[0,2],[2,4]]);
 const grouped=ExampleDialogsSchema.parse([{role:'user',content:'a',scene:'First'},{role:'assistant',content:'b'},...pair,{role:'user',content:'c',scene:'Second'},{role:'assistant',content:'d'}]);assert.deepEqual(exampleScenes(grouped),[{title:'First',start:0,end:4},{title:'Second',start:4,end:6}]);
 assert.throws(()=>ExampleDialogsSchema.parse([{role:'user',content:'a'},{role:'assistant',content:'b',scene:'bad'}]),/scene/);
});
void test('revised Fiammetta persona fits production schema and retains role and practical task scenarios',async()=>{
 const raw:unknown=JSON.parse(await readFile(new URL('../personas/fiammetta.json',import.meta.url),'utf8'));
 const persona=PersonaInputSchema.omit({name:true}).parse(raw);assert.equal(persona.exampleDialogs.length,90);assert.equal(exampleScenes(persona.exampleDialogs).length,17);
 assert.ok(exampleScenes(persona.exampleDialogs).some(s=>s.title==='操作权限'));assert.match(persona.instructions,/字数偏好不限制/);assert.match(persona.instructions,/发送者 ID/);
 assert.ok(persona.exampleDialogs.every(d=>d.role!=='assistant'||(!d.content.includes('（')&&d.content!=='哦。')));
});
