import { DatabaseSync, backup } from 'node:sqlite';
import { readFile, chmod, open } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { RuntimeConfigSchema, type RuntimeConfig } from '../packages/contracts/src/index.js';
import { PluginRecordSchema, type PluginRecord, type PluginId } from '../packages/contracts/src/plugins/index.js';
import { QQ_TOOLS } from '../packages/contracts/src/plugins/qq-file.js';
import { SearchSettingsSchema } from '../packages/contracts/src/search.js';
import { SecretNameSchema } from '../packages/contracts/src/operator.js';
import { BILIBILI_TOOL_NAMES } from '../packages/adapters/src/plugins/bilibili.js';
import { BANGUMI_TOOL_NAMES } from '../packages/adapters/src/plugins/bangumi.js';
const JsonObject = z.record(z.string(),z.unknown());
const ValueRow = z.object({value:z.string()});
interface SourceMapping { record?:PluginRecord; search?:ReturnType<typeof SearchSettingsSchema.parse>; secrets:Map<string,string>; tools:string[]; }
export interface NativeMigrationReport { applied:boolean;backupCreated:boolean;counts:{sources:number;plugins:number;search:number;secrets:number;agentsChanged:number;grantsChanged:number;templatesMapped:number};skips:string[];gaps:string[]; }
export interface NativeMigrationOptions { source:string;database:string;apply?:boolean;runtimeStopped?:boolean; }
function bool(value:unknown,fallback:boolean):boolean{return value===undefined?fallback:z.boolean().parse(value);}
function str(value:unknown,fallback=''):string{return value===undefined?fallback:z.string().parse(value);}
function num(value:unknown,fallback:number):number{return value===undefined?fallback:z.number().parse(value);}
function list(value:unknown):string[]{if(value===undefined)return [];if(typeof value==='string')return value.split(/[,\r\n]+/).map(s=>s.trim()).filter(Boolean);return z.array(z.union([z.string(),z.number()])).parse(value).map(String);}
function distinct(values:readonly string[]):string[]{return [...new Set(values)];}
function enumValue<T extends string>(value:unknown,options:readonly T[],fallback:T):T{if(value===undefined)return fallback;const found=options.find(option=>option===value);if(!found)throw new Error('Invalid enum configuration');return found;}
/** Only an unambiguous literal extension anchored at the end is translated. No regex is executed. */
export function suffixRegexToGlob(value:string):string|undefined { const match=/^(?:\(\?i\))?\^?\.\*\\\.([A-Za-z0-9_-]{1,30})\$$/.exec(value.trim());return match?.[1]?`*.${match[1]}`:undefined; }
const definitions:readonly {id:PluginId|'search';names:readonly string[]}[]=[
{id:'qq_file',names:['astrbot_plugin_qq_file_config.json','qq_file_config.json']},
{id:'markdown_killer',names:['astrbot_plugin_markdown_killer_config.json','markdown_killer_config.json']},
{id:'bili_video',names:['astrbot_plugin_biliVideo_config.json','biliVideo_config.json']},
{id:'bangumi',names:['astrbot_plugin_bangumi_enhance_config.json','astrbot_plugin_bangumi_config.json','bangumi_enhance_config.json']},
{id:'search',names:['astrbot_plugin_deepseek_search_config.json','deepseek_search_config.json']},
];
function mapSource(id:PluginId|'search',source:Record<string,unknown>,report:NativeMigrationReport):SourceMapping {
 const secrets=new Map<string,string>();const secret=(name:string,raw:unknown)=>{const value=str(raw).trim();if(value)secrets.set(name,value);};const enabled=bool(source.enabled,true);
 if(id==='search'){secret('DEEPSEEK_SEARCH_API_KEY',source.api_key);return {secrets,tools:['web_search','web_fetch','deepseek_search','deepseek_fetch'],search:SearchSettingsSchema.parse({enabled:enabled&&secrets.size>0,provider:'deepseek',apiBase:str(source.api_base,'https://api.deepseek.com')||'https://api.deepseek.com',apiKeyEnv:'DEEPSEEK_SEARCH_API_KEY',revision:1})};}
 if(id==='qq_file'){
  const access=enumValue(source.access_mode,['blacklist','whitelist','all'] as const,'blacklist');let unsupported=false;
  const templates=z.array(JsonObject).parse(source.auto_process_templates??[]).flatMap((template,index)=>{const patterns=list(template.file_patterns);const globs=patterns.map(suffixRegexToGlob);if(!patterns.length||globs.some(g=>g===undefined)||Object.keys(template).some(key=>/skill/i.test(key))){unsupported=true;report.gaps.push(`qq_file.template.${index+1}: regex or skill mapping requires review; original retained`);return [];}
   const prompt=str(template.prompt).trim();if(!prompt){unsupported=true;report.gaps.push(`qq_file.template.${index+1}: empty default prompt requires explicit replacement`);return [];}
   report.counts.templatesMapped++;return [{id:`astrbotx-template-${index+1}`,enabled:bool(template.enabled,true),groupIds:list(template.group_ids),filePatterns:globs.filter((g):g is string=>g!==undefined),prompt,skillLibraries:[]}];});
  if(templates.length)report.gaps.push('qq_file: native glob matching is case-insensitive; literal suffix patterns were translated');
  if(source.enable_file_search===false)report.gaps.push('qq_file: legacy search disable preserved by omitting qq_search_files from new bindings');
  return {record:PluginRecordSchema.parse({id,revision:1,settings:{enabled,access_mode:access==='blacklist'?'denylist':access==='whitelist'?'allowlist':'all',group_list:list(source.group_list),max_file_list_limit:num(source.max_file_list_limit,50),upload_auto_process:bool(source.enable_auto_process,false)&&!unsupported&&templates.length>0,uploadTemplates:templates}}),secrets,tools:QQ_TOOLS.filter(name=>name!=='qq_search_files'||source.enable_file_search!==false)};
 }
 if(id==='markdown_killer')return {record:PluginRecordSchema.parse({id,revision:1,settings:{enabled,globalCleanup:bool(source.enable_global_markdown_killer,false),newlineMode:bool(source.remove_extra_newlines,true)?enumValue(source.newline_mode,['segment_boundary','global'] as const,'segment_boundary'):'preserve',tableRender:bool(source.enable_table_render,true),formulaRender:bool(source.enable_formula_render,true),tableFallback:enumValue(source.table_render_fallback,['text','raw','remove'] as const,'text'),formulaFallback:enumValue(source.formula_render_fallback,['text','raw','remove'] as const,'raw')}}),secrets,tools:[]};
 if(id==='bili_video'){
  secret('BILIBILI_COOKIE',source.cookie??source.bilibili_cookie);secret('BILIBILI_ASR_TOKEN',source.local_multimodal_infra_token);
  const accessMode=enumValue(source.access_mode,['blacklist','whitelist'] as const,'blacklist');const groups=list(source.group_list);const detectMode=enumValue(source.detect_access_mode,['blacklist','whitelist'] as const,'blacklist');const detectGroups=list(source.detect_group_list);let autoDetect=bool(source.enable_miniapp_detect,false);
  if(autoDetect&&(detectMode!==accessMode||JSON.stringify([...detectGroups].sort())!==JSON.stringify([...groups].sort()))){autoDetect=false;report.gaps.push('bili_video: separate detection ACL differs; automatic detection disabled pending review');}
  if(source.llm_provider==='openai_compatible')report.gaps.push('bili_video: standalone summary provider retained in source; summaries now use current Agent model');
  if(bool(source.enable_auto_push,false)||list(source.push_groups).length||list(source.push_users).length)report.gaps.push('bili_video: automatic push destinations/subscriptions retained in source and left disabled');
  report.gaps.push('bili_video: provider-specific presentation/progress templates, split policy and render timeout remain in source; native renderer/runtime policy applies');
  return {record:PluginRecordSchema.parse({id,revision:1,settings:{enabled,accessMode,groupIds:groups,autoDetect,autoSummary:bool(source.detect_auto_summary,false),autoPush:false,pollMinutes:num(source.check_interval_minutes,600),maxSubscriptions:num(source.max_subscriptions,20),summaryStyle:enumValue(source.note_style,['concise','detailed','professional'] as const,'professional'),maxSummaryChars:num(source.max_note_length,3000),outputImage:bool(source.output_image,true),asr:{provider:enumValue(source.asr_provider,['disabled','bcut','local_multimodal_infra'] as const,'bcut'),baseUrl:str(source.local_multimodal_infra_base_url,'http://127.0.0.1:17890'),model:str(source.local_multimodal_infra_model,'sensevoice-small-onnx')||'sensevoice-small-onnx',timeoutSeconds:num(source.asr_timeout,600),granularitySeconds:num(source.asr_timestamp_granularity_sec,10),speakerDiarization:bool(source.asr_speaker_diarization,true)}}}),secrets,tools:[...BILIBILI_TOOL_NAMES]};
 }
 if(id==='bangumi'){
  secret('BANGUMI_TOKEN',source.access_token);const template=enumValue(source.episode_card_template,['pastel_lightbox','editorial_digest','cinematic_poster'] as const,'cinematic_poster');if(source.proxy_http||source.port)report.gaps.push('bangumi: legacy plugin proxy retained in source; configure runtime network separately');if(template!=='cinematic_poster')report.gaps.push('bangumi: legacy card theme approximated by native template');report.gaps.push('bangumi: remote renderer, retry/user-agent/search-size preferences remain in source; native defaults apply');
  return {record:PluginRecordSchema.parse({id,revision:1,settings:{enabled,autoPush:false,outputImage:bool(source.output_image,true),template:template==='pastel_lightbox'?'classic':template==='editorial_digest'?'minimal':template}}),secrets,tools:[...BANGUMI_TOOL_NAMES]};
 }
 return {secrets,tools:[]};
}
async function readSource(directory:string,names:readonly string[]):Promise<Record<string,unknown>|undefined>{for(const name of names){let text:string;try{text=await readFile(join(directory,name),'utf8');}catch(error){const parsed=z.object({code:z.string()}).safeParse(error);if(parsed.success&&parsed.data.code==='ENOENT')continue;throw new Error('Unable to read legacy plugin source', {cause:error});}try{const raw:unknown=JSON.parse(text.replace(/^\uFEFF/,''));return JsonObject.parse(raw);}catch{throw new Error(`Invalid JSON object in ${name}`);}}return undefined;}
function currentConfig(db:DatabaseSync):RuntimeConfig{const row=db.prepare('SELECT value FROM configuration ORDER BY revision DESC LIMIT 1').get();if(!row)throw new Error('Target runtime configuration does not exist');const raw:unknown=JSON.parse(ValueRow.parse(row).value);return RuntimeConfigSchema.parse(raw);}
function exists(db:DatabaseSync,namespace:string,id:string):boolean{return db.prepare('SELECT 1 FROM documents WHERE namespace=? AND id=?').get(namespace,id)!==undefined;}
function setSecret(db:DatabaseSync,name:string,value:string):void{SecretNameSchema.parse(name);z.string().min(1).max(65536).parse(value);db.prepare('INSERT OR IGNORE INTO documents(namespace,id,value) VALUES(?,?,?)').run('operator-secrets',name,JSON.stringify({name,value,updatedAt:Date.now()}));}
export async function migrateNativePlugins(options:NativeMigrationOptions):Promise<NativeMigrationReport>{
 if(options.apply&&!options.runtimeStopped)throw new Error('--apply requires --runtime-stopped; stop the runtime before applying');
 const report:NativeMigrationReport={applied:false,backupCreated:false,counts:{sources:0,plugins:0,search:0,secrets:0,agentsChanged:0,grantsChanged:0,templatesMapped:0},skips:[],gaps:[]};const mappings:SourceMapping[]=[];
 for(const definition of definitions){const source=await readSource(options.source,definition.names);if(!source){report.skips.push(`${definition.id}: source file absent`);continue;}report.counts.sources++;try{mappings.push(mapSource(definition.id,source,report));}catch{throw new Error(`Invalid legacy ${definition.id} settings; no changes applied`);}}
 const database=resolve(options.database);const db=new DatabaseSync(database,{readOnly:!options.apply});let transaction=false;
 try{
  if(options.apply){const backupPath=`${database}.native-plugins-backup-${Date.now()}-${randomUUID()}.sqlite`;const backupFile=await open(backupPath,'wx',0o600);await backupFile.close();await backup(db,backupPath);await chmod(backupPath,0o600);report.backupCreated=true;db.exec('BEGIN IMMEDIATE');transaction=true;}
  const original=currentConfig(db);const next=structuredClone(original);const pending:SourceMapping[]=[];const tools:string[]=[];let qq=false;
  for(const mapping of mappings){const namespace=mapping.record?'native-plugins':'web-search';const id=mapping.record?.id??'settings';if(exists(db,namespace,id)){report.skips.push(`${mapping.record?.id??'search'}: target settings already exist`);continue;}pending.push(mapping);tools.push(...mapping.tools);if(mapping.record){report.counts.plugins++;if(mapping.record.id==='qq_file')qq=true;}else report.counts.search++;for(const name of mapping.secrets.keys())if(exists(db,'operator-secrets',name))report.skips.push('credential: existing managed secret preserved');else report.counts.secrets++;}
  report.gaps.push('Automatic subscriptions and local reminiscence remain disabled; source files and archived plugin state are unchanged');
  const additions=distinct(tools);const approvals=['qq_delete_files','qq_delete_folder','qq_publish_group_notice','qq_delete_group_notice'];
  for(const agent of next.agents){const before=JSON.stringify(agent);agent.resources.tools=distinct([...agent.resources.tools,...additions]);if(qq){if(!agent.capabilities.includes('files.read'))agent.capabilities.push('files.read');agent.approvalTools=distinct([...agent.approvalTools,...approvals]);}if(JSON.stringify(agent)!==before)report.counts.agentsChanged++;}
  // Fixed sender roles do not duplicate Agent tool bindings.
  const configChanged=report.counts.agentsChanged>0||report.counts.grantsChanged>0;
  if(options.apply){for(const mapping of pending){const namespace=mapping.record?'native-plugins':'web-search';const id=mapping.record?.id??'settings';db.prepare('INSERT INTO documents(namespace,id,value) VALUES(?,?,?)').run(namespace,id,JSON.stringify(mapping.record??mapping.search));for(const [name,value]of mapping.secrets)if(!exists(db,'operator-secrets',name))setSecret(db,name,value);}
   if(configChanged){next.revision=original.revision+1;next.flow.revision=next.revision;RuntimeConfigSchema.parse(next);db.prepare('INSERT INTO configuration(revision,value,created_at) VALUES(?,?,?)').run(next.revision,JSON.stringify(next),Date.now());}
   report.applied=true;db.prepare('INSERT INTO documents(namespace,id,value) VALUES(?,?,?)').run('migration-reports',`native-plugins-${randomUUID()}`,JSON.stringify(report));db.exec('COMMIT');transaction=false;await chmod(database,0o600);
  }
  return report;
 }catch(error){if(transaction)db.exec('ROLLBACK');throw error;}finally{db.close();}
}
async function main():Promise<void>{try{const {values}=parseArgs({options:{source:{type:'string'},database:{type:'string'},apply:{type:'boolean',default:false},'runtime-stopped':{type:'boolean',default:false}}});if(!values.source||!values.database)throw new Error('Usage: --source <AstrBotX data/config> --database <runtime.sqlite> [--apply --runtime-stopped]');const report=await migrateNativePlugins({source:values.source,database:values.database,apply:values.apply,runtimeStopped:values['runtime-stopped']});process.stdout.write(JSON.stringify(report,null,2)+'\n');}catch{process.stderr.write('Native plugin migration failed. Check source schemas and paths; --apply also requires --runtime-stopped. No secret diagnostics are printed.\n');process.exitCode=1;}}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)await main();
