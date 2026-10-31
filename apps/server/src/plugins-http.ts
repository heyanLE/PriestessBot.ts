import { z } from 'zod';
import type { IncomingMessage,ServerResponse } from 'node:http';
import { PluginIdSchema } from '../../../packages/contracts/src/plugins/index.js';
import type { PriestessRuntime } from './runtime.js';
interface Context{runtime:PriestessRuntime;request:IncomingMessage;response:ServerResponse;url:URL;body:(request:IncomingMessage)=>Promise<unknown>;json:(response:ServerResponse,status:number,value:unknown)=>void;}
/** Only invoked after shared management authentication and same-origin validation. */
export async function handlePluginsHttp({runtime,request,response,url,body,json}:Context):Promise<boolean>{
 const [resource,rawId,action]=url.pathname.slice('/api/ts/'.length).split('/').map(decodeURIComponent);
 if(resource!=='plugins')return false;const plugins=runtime.plugins;
 try{
  if(!rawId&&request.method==='GET'){json(response,200,plugins.catalogue());return true;}
  if(rawId==='tools'&&request.method==='GET'){json(response,200,{tools:[...plugins.toolCatalogue().tools,...['web_search','web_fetch','deepseek_search','deepseek_fetch'].map(id=>({id,label:`网络搜索 · ${id}`,detail:'独立搜索服务配置，需启用服务和 Agent 工具授权'}))]});return true;}
  const id=PluginIdSchema.parse(rawId);
  if(!action&&request.method==='GET')json(response,200,plugins.settings.get(id));
  else if(!action&&request.method==='PUT'){const input=z.object({expectedRevision:z.number().int().nonnegative(),settings:z.unknown()}).strict().parse(await body(request));json(response,200,plugins.settings.update(id,input.settings,input.expectedRevision));}
  else if(action==='status'&&request.method==='GET'){
   const details:{label:string;value:string}[]=[];
   if(id==='bili_video'){const status=plugins.bili.status();details.push({label:'登录凭据',value:status.authenticated?'已配置（未实时验证）':'未配置'},{label:'订阅数',value:String(status.subscriptions)},{label:'转写',value:status.asr});}
   if(id==='bangumi'){const status=plugins.bangumi.status();details.push({label:'账号令牌',value:status.authenticated?'已配置':'未配置'},{label:'订阅数',value:String(status.subscriptions)});}
   if(id==='markdown_killer'){const status=await plugins.markdown.availability();details.push({label:'图片渲染器',value:status.available?'Chromium 可用':status.reason??'Chromium 未安装'});}
   if(id==='qq_file'){for(const platform of runtime.platformStatus())details.push({label:platform.id,value:platform.status});}
   if(id==='local_reminiscence'){const overview=plugins.reminiscence.overview();details.push({label:'检索模式',value:overview.embeddingMode==='lexical'?'词汇检索':'本机语义向量服务'},{label:'独立记忆范围',value:String(overview.scopes.length)},{label:'整理记录',value:String(overview.records.length)});}
   json(response,200,{details});
  }else if((id==='bili_video'||id==='bangumi')&&action==='subscriptions'&&request.method==='GET'){
   const subscriptions=id==='bili_video'?plugins.bili.listSubscriptions().map(s=>({id:s.id,platform:s.owner.principal.platform,sessionId:s.owner.principal.sessionId,senderId:s.owner.principal.senderId,target:s.name,nextAt:s.nextAt,error:s.error})):plugins.bangumi.listSubscriptions().map(s=>({id:s.id,platform:s.owner.principal.platform,sessionId:s.owner.principal.sessionId,senderId:s.owner.principal.senderId,target:s.title,nextAt:s.nextAt,error:s.error}));json(response,200,{subscriptions});
  }else if((id==='bili_video'||id==='bangumi')&&action==='subscriptions'&&request.method==='DELETE'){
   const data=z.object({id:z.string().min(1)}).parse(await body(request));if(id==='bili_video')plugins.bili.removeSubscription(data.id);else plugins.bangumi.removeSubscription(data.id);json(response,200,{ok:true});
  }else if(id==='bili_video'&&action==='login'&&request.method==='POST')json(response,200,await plugins.bili.loginStart(AbortSignal.timeout(30000)));
  else if(id==='bili_video'&&action==='login-poll'&&request.method==='POST'){const input=z.object({id:z.string().min(1)}).parse(await body(request));json(response,200,await plugins.bili.loginPoll(input.id,AbortSignal.timeout(30000)));}
  else if(id==='bili_video'&&action==='logout'&&request.method==='POST'){plugins.bili.logout();json(response,200,{ok:true});}
  else if(id==='local_reminiscence'&&action==='records'&&request.method==='GET')json(response,200,plugins.reminiscence.overview());
  else if(id==='local_reminiscence'&&action==='records'&&request.method==='POST'){
   const requestData=z.object({scopeKey:z.string().min(1),operation:z.enum(['daily','consolidate','reindex','delete_day']),date:z.string().optional()}).strict().parse(await body(request));
   if(requestData.operation==='delete_day'){plugins.reminiscence.deleteDay(requestData.scopeKey,z.string().regex(/^\d{4}-\d{2}-\d{2}$/).parse(requestData.date));}
   else{const owner=plugins.reminiscence.owner(requestData.scopeKey);const input=owner?runtime.resumePlugin(owner):undefined;if(!input)throw new Error('Original memory scope authorization expired; record a new authorized turn first');
    if(requestData.operation==='daily')await plugins.reminiscence.summarizeDay(input,z.string().regex(/^\d{4}-\d{2}-\d{2}$/).parse(requestData.date));
    else if(requestData.operation==='consolidate')await plugins.reminiscence.consolidate(input);else await plugins.reminiscence.reindex(input);
   }json(response,200,plugins.reminiscence.overview());
  }else json(response,405,{error:'Unsupported plugin operation'});
 }catch(error){if(error instanceof z.ZodError)json(response,400,{error:'Invalid plugin configuration or parameters'});else if(error instanceof Error&&error.message==='Plugin revision conflict')json(response,409,{error:error.message});else json(response,400,{error:'Plugin operation did not complete. Check configuration, original scope authorization and upstream availability.'});}
 return true;
}
