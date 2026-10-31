import type { SdkLocalContext } from '../../../packages/adapters/src/agents/engine.js';
import type { Tool } from '@openai/agents';
import { PluginIdSchema, pluginMetadata, type PluginId } from '../../../packages/contracts/src/plugins/index.js';
import { QqFileSettingsSchema, QQ_TOOLS } from '../../../packages/contracts/src/plugins/qq-file.js';
import { BilibiliSettingsSchema } from '../../../packages/contracts/src/plugins/bilibili.js';
import { BangumiSettingsSchema } from '../../../packages/contracts/src/plugins/bangumi.js';
import { MarkdownSettingsSchema } from '../../../packages/contracts/src/plugins/markdown.js';
import { ReminiscenceSettingsSchema } from '../../../packages/contracts/src/plugins/reminiscence.js';
import type { EngineInput } from '../../../packages/contracts/src/index.js';
import type { CommandOutcome } from '../../../packages/core/src/commands.js';
import { QqFileService, type QqFileServiceOptions } from '../../../packages/adapters/src/plugins/qq-file.js';
import { BilibiliPlugin, BILIBILI_TOOL_NAMES } from '../../../packages/adapters/src/plugins/bilibili.js';
import { BangumiPlugin, BANGUMI_TOOL_NAMES } from '../../../packages/adapters/src/plugins/bangumi.js';
import { MarkdownPlugin } from '../../../packages/adapters/src/plugins/markdown.js';
import { ReminiscencePlugin } from '../../../packages/adapters/src/plugins/reminiscence.js';
import type { MediaPluginDependencies, MediaTickHost } from '../../../packages/adapters/src/plugins/media-common.js';
import { PluginSettings } from './plugin-settings.js';
export const REMINISCENCE_TOOLS=['reminiscence_record','recall_memory_tool','deep_recall_tool','recall_recent_events_tool','write_node_tool','recall_node_tool','daily_summary_tool','memory_consolidation'];
export class RuntimePlugins {
 readonly settings:PluginSettings;
 readonly qq:QqFileService; readonly bili:BilibiliPlugin; readonly bangumi:BangumiPlugin; readonly markdown:MarkdownPlugin; readonly reminiscence:ReminiscencePlugin;
 private timer:ReturnType<typeof setInterval>|undefined;
 private active:Promise<void>|undefined;
 private readonly diagnostics=new Map<PluginId,string>();
 constructor(private readonly deps:MediaPluginDependencies & {qq:Omit<QqFileServiceOptions,'settings'|'auth'>;host:MediaTickHost}) {
  this.settings=new PluginSettings(deps.store);
  this.qq=new QqFileService({...deps.qq,auth:deps.auth,settings:()=>QqFileSettingsSchema.parse(this.settings.get('qq_file').settings)});
  this.bili=new BilibiliPlugin({...deps,settings:()=>BilibiliSettingsSchema.parse(this.settings.get('bili_video').settings)});
  this.bangumi=new BangumiPlugin({...deps,settings:()=>BangumiSettingsSchema.parse(this.settings.get('bangumi').settings)});
  this.markdown=new MarkdownPlugin(()=>MarkdownSettingsSchema.parse(this.settings.get('markdown_killer').settings));
  this.reminiscence=new ReminiscencePlugin({...deps,settings:()=>ReminiscenceSettingsSchema.parse(this.settings.get('local_reminiscence').settings)});
 }
 toolNames(id:PluginId):readonly string[] {return id==='qq_file'?QQ_TOOLS:id==='bili_video'?BILIBILI_TOOL_NAMES:id==='bangumi'?BANGUMI_TOOL_NAMES:id==='local_reminiscence'?REMINISCENCE_TOOLS:[];}
 catalogue(){return {plugins:PluginIdSchema.options.map(id=>{const record=this.settings.get(id);return{id,...pluginMetadata[id],record,tools:[...this.toolNames(id)],status:record.settings.enabled?(this.diagnostics.has(id)?'failed':'enabled'):'disabled',diagnostic:this.diagnostics.get(id)??''};})};}
 note(id:PluginId,message:string):void{if(message)this.diagnostics.set(id,message);else this.diagnostics.delete(id);}
 toolCatalogue(){return {tools:PluginIdSchema.options.flatMap(id=>this.toolNames(id).map(name=>({id:name,label:`${pluginMetadata[id].name} · ${name}`,detail:pluginMetadata[id].description}))) };}
 tools(input:EngineInput):Tool<SdkLocalContext>[]{return [...this.qq.buildTools(input),...this.bili.tools(input),...this.bangumi.tools(input),...this.reminiscence.tools(input)];}
 async command(input:EngineInput,text:string):Promise<CommandOutcome>{
  if(this.settings.get('bili_video').settings.enabled){const result=await this.bili.command(input,text);if(result.status!=='unhandled')return result;}
  if(this.settings.get('bangumi').settings.enabled){const result=await this.bangumi.command(input,text);if(result.status!=='unhandled')return result;}
  return {status:'unhandled'};
 }
 async detect(input:EngineInput,text:string):Promise<string|undefined>{if(!this.settings.get('bili_video').settings.enabled)return undefined;try{return await this.bili.detect(input,text);}catch{this.diagnostics.set('bili_video','链接识别未完成，请检查登录、授权和上游状态。');return undefined;}}
 commandPresentation(input:EngineInput,text:string):'classic'|'minimal'|'cinematic_poster'|undefined{
  if(/^\/(总结|重新总结|最新视频)(?:\s|$)/.test(text)){const p=this.bili.presentation();return p.image?p.template:undefined;}
  if(/^\/(bgm|today|calendar)/.test(text)){const p=this.bangumi.presentation(input);return p.image?p.template:undefined;}
  return undefined;
 }
 start():void{if(this.timer)return;this.timer=setInterval(()=>{if(this.active)return;this.active=this.tick().finally(()=>{this.active=undefined;});},60000);this.timer.unref();}
 private async tick():Promise<void>{for(const [id,work] of [
  ['bili_video',()=>this.bili.tick(this.deps.host)],['bangumi',()=>this.bangumi.tick(this.deps.host)],['local_reminiscence',()=>this.reminiscence.tick(this.deps.host)],
 ] satisfies [PluginId,()=>Promise<void>][]){try{await work();this.diagnostics.delete(id);}catch{this.diagnostics.set(id,'定时任务未完成，等待下次调度。');}}}
 async stop():Promise<void>{if(this.timer)clearInterval(this.timer);this.timer=undefined;await this.active;await this.bangumi.stop();}
}
