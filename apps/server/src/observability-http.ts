import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import type { PriestessRuntime } from './runtime.js';
import { parseRecordQuery, RecordNotFound, type RecordQuery } from './observability.js';
export function handleObservabilityHttp(runtime: PriestessRuntime, request: IncomingMessage, response: ServerResponse, url: URL, json: (response: ServerResponse, status: number, value: unknown) => void): boolean {
  const parts=url.pathname.slice('/api/ts/'.length).split('/').map(decodeURIComponent);const [resource,id,action]=parts;
  if(resource!=='route-records'&&resource!=='agent-records')return false;
  try {
    if(request.method!=='GET'){json(response,405,{error:'此记录接口只支持读取。'});return true;}
    const service=runtime.observability;
    if(!id){
      let query: RecordQuery;
      try { query=parseRecordQuery(url.searchParams); }
      catch(error){if(error instanceof z.ZodError){json(response,400,{error:'筛选参数无效。请检查时间、状态和分页范围。'});return true;}throw error;}
      json(response,200,resource==='route-records'?service.routes(query):service.agents(query));return true;
    }
    if(action&&action!=='export'){json(response,404,{error:'记录接口不存在。'});return true;}
    const detail=resource==='route-records'?service.route(id):service.agent(id);
    if(action==='export'){
      const data={...detail,format:resource==='route-records'?'priestessbot-route-audit-v1':'priestessbot-agent-audit-v1',exportedAt:Date.now()};
      if(Buffer.byteLength(JSON.stringify(data))>4_000_000){json(response,413,{error:'审计记录超过 4 MB 导出上限。请在详情中逐项查看输入与输出。'});return true;}
      runtime.operator.audit(`${resource}.export`, id);
      runtime.store.put('audit-exports',`${Date.now()}-${id}`,{id,kind:resource,exportedAt:Date.now(),redaction:'bounded_redacted'});
      response.setHeader('Content-Disposition',`attachment; filename="${resource}-${id.replace(/[^a-zA-Z0-9_-]/gu,'_').slice(0,80)}.json"`);json(response,200,data);return true;
    }
    json(response,200,detail);return true;
  }catch(error){
    if(error instanceof RecordNotFound){json(response,404,{error:'记录不存在，或此消息未进入 Agent。'});return true;}
    json(response,500,{error:'服务器无法读取此审计记录。请联系管理员检查记录数据。'});return true;
  }
}
