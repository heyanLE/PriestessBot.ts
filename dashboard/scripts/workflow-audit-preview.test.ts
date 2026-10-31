import assert from 'node:assert/strict';
import { test } from 'node:test';
import { auditSections, auditJsonChildren, auditJsonSummary, auditTextExcerpt, parseAuditText } from '../src/components/typescript/audit-preview-model.ts';

test('model input separates instructions, ordered role messages, tools and settings while retaining extra fields', () => {
  const parsed=parseAuditText(JSON.stringify({systemInstructions:'系统\n说明',input:[{role:'user',content:'问题'},{type:'message',role:'assistant',content:[{type:'output_text',text:'回答'}]}],tools:[{type:'function',name:'read_file'}],settings:{temperature:0,maxTokens:100},futureField:{enabled:false}}));
  assert.equal(parsed.kind,'json');if(parsed.kind!=='json')return;
  const sections=auditSections(parsed.value);assert.deepEqual(sections.map(section=>section.title),['系统指令','输入消息','可用工具','模型参数','其他输入字段']);
  const system=sections[0];assert.equal(system?.kind,'data');if(system?.kind==='data'){assert.equal(system.collapsed,true);assert.equal(system.value,'系统\n说明');}
  const messages=sections[1];assert.equal(messages?.kind,'messages');if(messages?.kind!=='messages')return;
  assert.deepEqual(messages.cards.map(card=>card.title),['用户消息','助手消息']);assert.deepEqual(messages.cards[1]?.blocks,[{kind:'text',text:'回答'}]);
  assert.deepEqual(JSON.parse(parsed.formatted),JSON.parse(JSON.stringify(parsed.value)));
});

test('SDK output shows tool names and call IDs and decodes saved argument JSON without repairing truncated values', () => {
  const sections=auditSections([{type:'function_call',name:'exec',callId:'call-1',arguments:'{"command":"pwd","count":0}'},{type:'function_call',name:'read',call_id:'call-2',arguments:'{"file":"truncated'},{type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:'完成',annotations:[]}]}]);
  const section=sections[0];assert.equal(section?.kind,'messages');if(section?.kind!=='messages')return;
  assert.equal(section.cards[0]?.title,'调用工具 · exec');assert.deepEqual(section.cards[0]?.metadata,['调用 ID：call-1']);
  assert.deepEqual(section.cards[0]?.blocks,[{kind:'data',label:'工具参数',value:{command:'pwd',count:0},collapsed:false}]);
  assert.deepEqual(section.cards[1]?.blocks,[{kind:'data',label:'工具参数',value:'{"file":"truncated',collapsed:false}]);
  assert.equal(section.cards[2]?.metadata[0],'状态：已完成');assert.equal(section.cards[2]?.blocks[1]?.kind,'data');
});

test('tool results and wrapper fields preserve false, zero, empty arrays and recorded omission markers', () => {
  const sections=auditSections({output:[{type:'function_call_result',name:'lookup',callId:'call-1',output:'{"ok":false,"count":0,"items":[],"note":"[已省略]"}'}],usage:{inputTokens:0}});
  assert.equal(sections[0]?.kind,'messages');const section=sections[0];if(section?.kind!=='messages')return;
  assert.equal(section.cards[0]?.title,'工具结果 · lookup');
  assert.deepEqual(section.cards[0]?.blocks,[{kind:'data',label:'返回内容',value:{ok:false,count:0,items:[],note:'[已省略]'},collapsed:false}]);
  assert.deepEqual(sections[1],{kind:'data',title:'其他字段',value:{usage:{inputTokens:0}},collapsed:true});
});

test('HTML and remote media stay inert text or data and retain unknown provider fields', () => {
  const image={type:'input_image',imageUrl:'https://example.invalid/private.png'};
  const sections=auditSections([{type:'message',role:'user',providerData:{keep:'visible'},content:[{type:'input_text',text:'<script>alert(1)</script>'},image]}]);
  const section=sections[0];assert.equal(section?.kind,'messages');if(section?.kind!=='messages')return;
  assert.deepEqual(section.cards[0]?.blocks,[{kind:'text',text:'<script>alert(1)</script>'},{kind:'data',label:'图片字段（不自动加载）',value:image,collapsed:true}]);
  assert.deepEqual(section.cards[0]?.extra,{providerData:{keep:'visible'}});
});

test('historical invalid JSON is preserved exactly and ordinary text is not presented as a parse failure', () => {
  const truncated='{"systemInstructions":"cut\n[已截断]';
  assert.deepEqual(parseAuditText(truncated),{kind:'text',text:truncated,incompleteJson:true,structureUnavailable:false});
  assert.deepEqual(parseAuditText('普通文本'),{kind:'text',text:'普通文本',incompleteJson:false,structureUnavailable:false});
  assert.equal(parseAuditText('null').kind,'json');assert.equal(parseAuditText('false').kind,'json');
});

test('generic JSON tree preserves field keys and scalars without prototype lookups', () => {
  const parsed=parseAuditText('{"__proto__":{"x":1},"constructor":"saved","nested":[0,false,null]}');
  assert.equal(parsed.kind,'json');if(parsed.kind!=='json')return;
  assert.deepEqual(auditJsonChildren(parsed.value).map(child=>child.key),['__proto__','constructor','nested']);
  assert.equal(auditJsonSummary([0,false,null]),'数组 · 3 项');assert.equal(auditJsonSummary(null),'null');
  const messages=auditSections([{role:'constructor',content:'plain'}])[0];
  assert.equal(messages?.kind,'messages');if(messages?.kind==='messages')assert.equal(messages.cards[0]?.title,'constructor 消息');
});

test('deep JSON falls back without recursion overflow and long text folding leaves the source unchanged', () => {
  const deep='['.repeat(80)+'0'+']'.repeat(80);const parsed=parseAuditText(deep);
  assert.deepEqual(parsed,{kind:'text',text:deep,incompleteJson:false,structureUnavailable:true});
  const long='字'.repeat(900);const excerpt=auditTextExcerpt(long);assert.equal(excerpt.shortened,true);assert.equal(excerpt.text.length,701);assert.equal(long.length,900);
  assert.deepEqual(auditTextExcerpt('完整'),{text:'完整',shortened:false});
});
