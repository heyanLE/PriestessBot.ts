import { RecordLinkSchema } from '../../../../packages/contracts/src/observability';
import { RuntimeRequestError, runtimeRequest } from '../../api/typescript';

export type RecordDestination = {path:'/route-records';query:{record:string}} | {path:'/agent-records';query:{run:string}};
export async function resolveRunRecordDestination(id:string, signal?:AbortSignal):Promise<RecordDestination> {
  const link=await runtimeRequest(`runs/${encodeURIComponent(id)}/record-link`,RecordLinkSchema,undefined,'GET',signal);
  return link.kind==='route'?{path:'/route-records',query:{record:link.id}}:{path:'/agent-records',query:{run:link.id}};
}
export async function recoverLegacyCommandDestination(id:string, cause:unknown, signal?:AbortSignal):Promise<RecordDestination|null> {
  if(!(cause instanceof RuntimeRequestError)||cause.status!==404)return null;
  const target=await resolveRunRecordDestination(id,signal);
  return target.path==='/route-records'?target:null;
}
