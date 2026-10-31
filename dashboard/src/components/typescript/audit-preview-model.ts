export type AuditJsonValue = null | boolean | number | string | AuditJsonValue[] | AuditJsonObject;
export interface AuditJsonObject { [key:string]:AuditJsonValue; }
export type ParsedAuditText = {kind:'json';value:AuditJsonValue;formatted:string} | {kind:'text';text:string;incompleteJson:boolean;structureUnavailable:boolean};
export type AuditMessageBlock = {kind:'text';text:string} | {kind:'data';label:string;value:AuditJsonValue;collapsed:boolean};
export interface AuditMessageCard { title:string;metadata:string[];blocks:AuditMessageBlock[];extra:AuditJsonObject|null; }
export type AuditSection = {kind:'messages';title:string;cards:AuditMessageCard[]} | {kind:'data';title:string;value:AuditJsonValue;collapsed:boolean};

function isJsonValue(value:unknown,depth=0):value is AuditJsonValue {
  if(depth>48)return false;
  if(value===null||typeof value==='string'||typeof value==='boolean')return true;
  if(typeof value==='number')return Number.isFinite(value);
  if(Array.isArray(value)){const items:unknown[]=value;return items.every(item=>isJsonValue(item,depth+1));}
  if(typeof value==='object'){const items:unknown[]=Object.values(value);return items.every(item=>isJsonValue(item,depth+1));}
  return false;
}
export function isAuditJsonObject(value:AuditJsonValue):value is AuditJsonObject { return typeof value==='object'&&value!==null&&!Array.isArray(value); }
export function parseAuditText(text:string):ParsedAuditText {
  try{const value:unknown=JSON.parse(text);if(isJsonValue(value))return {kind:'json',value,formatted:JSON.stringify(value,null,2)};return {kind:'text',text,incompleteJson:false,structureUnavailable:true};}catch{/* Incomplete historical previews remain readable as text. */}
  return {kind:'text',text,incompleteJson:/^\s*[\[{]/.test(text),structureUnavailable:false};
}
export function auditJsonSummary(value:AuditJsonValue):string {
  if(Array.isArray(value))return `数组 · ${value.length} 项`;
  if(isAuditJsonObject(value))return `对象 · ${Object.keys(value).length} 个字段`;
  if(value===null)return 'null';
  if(typeof value==='string')return `文本 · ${value.length.toLocaleString('zh-CN')} 字符`;
  return String(value);
}
export function auditJsonChildren(value:AuditJsonValue):{key:string;value:AuditJsonValue}[] {
  if(Array.isArray(value))return value.map((item,index)=>({key:String(index),value:item}));
  return isAuditJsonObject(value)?Object.entries(value).map(([key,item])=>({key,value:item})):[];
}
export function auditTextExcerpt(text:string,limit=700):{text:string;shortened:boolean} { return {text:text.length>limit?`${text.slice(0,limit)}…`:text,shortened:text.length>limit}; }
function stringField(value:AuditJsonObject,key:string):string { const field=value[key];return typeof field==='string'?field:''; }
function extraFields(value:AuditJsonObject,used:readonly string[]):AuditJsonObject|null {
  const entries=Object.entries(value).filter(([key])=>!used.includes(key));return entries.length?Object.fromEntries(entries):null;
}
function nestedJson(value:AuditJsonValue):AuditJsonValue { if(typeof value!=='string'||!/^\s*[\[{]/.test(value))return value;const parsed=parseAuditText(value);return parsed.kind==='json'?parsed.value:value; }
const messageTypes=new Set(['message','function_call','tool_call','function_call_output','function_call_result','tool_result','reasoning','input_text','output_text','text','input_image','image','image_url','input_file','file']);
function messageLike(value:AuditJsonValue):boolean { return isAuditJsonObject(value)&&(typeof value['role']==='string'||messageTypes.has(stringField(value,'type'))); }
function contentBlocks(content:AuditJsonValue):AuditMessageBlock[] {
  if(typeof content==='string')return [{kind:'text',text:content}];
  if(Array.isArray(content))return content.flatMap(item=>contentBlocks(item));
  if(isAuditJsonObject(content)){
    const type=stringField(content,'type');const text=content['text'];
    if(['input_text','output_text','text','summary_text'].includes(type)&&typeof text==='string'){
      const extra=extraFields(content,['type','text']);return [{kind:'text',text},...(extra?[{kind:'data',label:'文本附加字段',value:extra,collapsed:true} satisfies AuditMessageBlock]:[])];
    }
    const label=['input_image','image','image_url'].includes(type)?'图片字段（不自动加载）':['input_file','file'].includes(type)?'文件字段（不自动下载）':type.includes('audio')?'音频字段（不自动播放）':'消息内容字段';
    return [{kind:'data',label,value:content,collapsed:true}];
  }
  return [{kind:'data',label:'消息内容',value:content,collapsed:false}];
}
function messageCard(value:AuditJsonValue,index:number):AuditMessageCard {
  if(typeof value==='string')return {title:'用户消息',metadata:[],blocks:[{kind:'text',text:value}],extra:null};
  if(!isAuditJsonObject(value))return {title:`消息 ${index+1}`,metadata:[],blocks:[{kind:'data',label:'消息字段',value,collapsed:false}],extra:null};
  const type=stringField(value,'type');const role=stringField(value,'role');const name=stringField(value,'name');
  const callId=stringField(value,'callId')||stringField(value,'call_id');const id=stringField(value,'id');const status=stringField(value,'status');
  const metadata=[...(callId?[`调用 ID：${callId}`]:[]),...(id?[`消息 ID：${id}`]:[]),...(status?[`状态：${status==='completed'?'已完成':status==='in_progress'?'进行中':status==='incomplete'?'未完成':status}`]:[])];
  const used=['type','role','name','callId','call_id','id','status'];
  if(type==='function_call'||type==='tool_call')return {title:`调用工具${name?` · ${name}`:''}`,metadata,blocks:[{kind:'data',label:'工具参数',value:nestedJson(value['arguments']??value['input']??null),collapsed:false}],extra:extraFields(value,[...used,'arguments','input'])};
  if(type==='function_call_output'||type==='function_call_result'||type==='tool_result'||role==='tool')return {title:`工具结果${name?` · ${name}`:''}`,metadata,blocks:[{kind:'data',label:'返回内容',value:nestedJson(value['output']??value['result']??value['content']??null),collapsed:false}],extra:extraFields(value,[...used,'output','result','content'])};
  const labels:Readonly<Record<string,string>>={system:'系统消息',developer:'开发者消息',user:'用户消息',assistant:'助手消息'};
  if(role||type==='message')return {title:(Object.hasOwn(labels,role)?labels[role]:undefined)??(role?`${role} 消息`:'消息'),metadata,blocks:contentBlocks(value['content']??value['text']??null),extra:extraFields(value,[...used,'content','text'])};
  if(type==='reasoning')return {title:'已记录的推理摘要',metadata,blocks:contentBlocks(value['summary']??value['content']??null),extra:extraFields(value,[...used,'summary','content'])};
  return {title:'消息片段',metadata,blocks:contentBlocks(value),extra:null};
}
function messagesSection(value:AuditJsonValue,title:string):AuditSection {
  if(typeof value==='string')return {kind:'messages',title,cards:[messageCard(value,0)]};
  if(Array.isArray(value))return {kind:'messages',title,cards:value.map(messageCard)};
  return messageLike(value)?{kind:'messages',title,cards:[messageCard(value,0)]}:{kind:'data',title,value,collapsed:false};
}
/** Views reorganize only saved preview fields; raw preview remains available without loading URLs. */
export function auditSections(value:AuditJsonValue):AuditSection[] {
  if(isAuditJsonObject(value)&&'input' in value&&('systemInstructions' in value||'tools' in value||'settings' in value)){
    const sections:AuditSection[]=[];
    if(value['systemInstructions']!==undefined)sections.push({kind:'data',title:'系统指令',value:value['systemInstructions'],collapsed:true});
    sections.push(messagesSection(value['input']??null,'输入消息'));
    if(value['tools']!==undefined)sections.push({kind:'data',title:'可用工具',value:value['tools'],collapsed:true});
    if(value['settings']!==undefined)sections.push({kind:'data',title:'模型参数',value:value['settings'],collapsed:true});
    const extra=extraFields(value,['systemInstructions','input','tools','settings']);if(extra)sections.push({kind:'data',title:'其他输入字段',value:extra,collapsed:true});
    return sections;
  }
  if(Array.isArray(value)&&value.length>0&&value.every(messageLike))return [messagesSection(value,'消息与工具调用')];
  if(messageLike(value))return [messagesSection(value,'消息与工具调用')];
  if(isAuditJsonObject(value))for(const key of ['messages','output']){const items=value[key];if(Array.isArray(items)&&items.every(messageLike)){const extra=extraFields(value,[key]);return [messagesSection(items,key==='output'?'输出消息':'消息列表'),...(extra?[{kind:'data',title:'其他字段',value:extra,collapsed:true} satisfies AuditSection]:[])];}}
  return [{kind:'data',title:'预览内容',value,collapsed:false}];
}
