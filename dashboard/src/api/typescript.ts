import { RunEventSchema, type RunEvent } from '../../../packages/contracts/src/index';

export const RUNTIME_AUTH_EXPIRED_EVENT = 'priestess:auth-expired';
export type RuntimeRequestErrorCode = 'unauthorized' | 'forbidden' | 'not_found' | 'conflict' | 'payload_too_large' | 'rate_limited' | 'server_error' | 'http_error' | 'network_error' | 'invalid_request' | 'invalid_json' | 'invalid_response' | 'stream_unavailable';
export class RuntimeRequestError extends Error {
  readonly code: RuntimeRequestErrorCode;
  readonly status: number | undefined;
  readonly detail: string | undefined;

  constructor(code: RuntimeRequestErrorCode, message: string, options: { status?: number; detail?: string } = {}) {
    super(message);
    this.name = 'RuntimeRequestError';
    this.code = code;
    this.status = options.status;
    this.detail = options.detail;
  }
}

let managementToken = '';
export function authorizeRuntime(token: string): void { managementToken = token; }
function headers(): Headers { const value = new Headers({ 'Content-Type': 'application/json' }); if (managementToken) value.set('Authorization', `Bearer ${managementToken}`); return value; }

function isAbortError(cause: unknown): boolean { return cause instanceof Error && cause.name === 'AbortError'; }
function networkError(): RuntimeRequestError { return new RuntimeRequestError('network_error', '无法连接管理服务。当前输入已保留。请检查网络，并确认上次操作结果后再重试。'); }
function httpError(status: number): RuntimeRequestError {
  const options = { status };
  // Server error strings can contain upstream responses or submitted values. Only show controlled descriptions.
  if (status === 401) return new RuntimeRequestError('unauthorized', '管理令牌无效，或登录已过期。请重新登录。当前输入已保留。', options);
  if (status === 403) return new RuntimeRequestError('forbidden', '无权执行此操作。请检查管理权限与访问来源。', options);
  if (status === 404) return new RuntimeRequestError('not_found', '找不到所选对象。当前输入已保留。请刷新列表，再选择一个对象。', options);
  if (status === 409) return new RuntimeRequestError('conflict', '此内容已被更新。当前输入已保留。请读取最新版本，合并修改后再保存。', options);
  if (status === 413) return new RuntimeRequestError('payload_too_large', '提交内容超过大小上限。当前输入已保留。请按页面上限缩小内容或文件。', options);
  if (status === 429) return new RuntimeRequestError('rate_limited', '请求过于频繁。请稍后重试。系统不会自动重复提交。', options);
  if (status >= 500) return new RuntimeRequestError('server_error', `管理服务暂时无法完成请求（HTTP ${status}）。当前输入已保留。请先确认操作结果，再决定是否重试。`, options);
  return new RuntimeRequestError('http_error', `请求未通过检查（HTTP ${status}）。当前输入已保留。请检查必填项、参数范围和关联资源。`, options);
}
function requestBody(body: unknown): string | undefined {
  if (body === undefined) return undefined;
  try { return JSON.stringify(body); }
  catch { throw new RuntimeRequestError('invalid_request', '提交内容格式错误。当前输入已保留。请检查输入内容。'); }
}
async function checkedFetch(path: string, options: RequestInit): Promise<Response> {
  let response: Response;
  try { response = await fetch(`/api/ts/${path}`, options); }
  catch (cause) { if (isAbortError(cause)) throw cause; throw networkError(); }
  if (!response.ok) {
    if (response.status === 401 && typeof window !== 'undefined') window.dispatchEvent(new Event(RUNTIME_AUTH_EXPIRED_EVENT));
    throw httpError(response.status);
  }
  return response;
}
function parseResponse<T>(raw: unknown, schema: { parse(value: unknown): T }, status: number): T {
  try { return schema.parse(raw); }
  catch { throw new RuntimeRequestError('invalid_response', '页面与管理服务的数据格式不一致。当前输入已保留。请先导出草稿，再检查服务版本。', { status }); }
}
async function responseJson(response: Response): Promise<unknown> {
  try { const raw: unknown = await response.json(); return raw; }
  catch (cause) {
    if (isAbortError(cause)) throw cause;
    if (cause instanceof SyntaxError) throw new RuntimeRequestError('invalid_json', '无法读取管理服务的响应。当前输入已保留。请检查服务状态。', { status: response.status });
    throw networkError();
  }
}
export async function runtimeRequest<T>(path: string, schema: { parse(value: unknown): T }, body?: unknown, method: 'GET' | 'POST' | 'PUT' | 'DELETE' = body === undefined ? 'GET' : 'POST', signal?: AbortSignal): Promise<T> {
  const serialized = requestBody(body);
  const response = await checkedFetch(path, { method, headers: headers(), ...(serialized === undefined ? {} : { body: serialized }), ...(signal === undefined ? {} : { signal }) });
  return parseResponse(await responseJson(response), schema, response.status);
}
/** Fetch exact saved model text through the same management authentication boundary. */
export async function runtimeText(path: string, signal?: AbortSignal): Promise<string> {
  const response = await checkedFetch(path, { method: 'GET', headers: headers(), ...(signal === undefined ? {} : { signal }) });
  try { return await response.text(); }
  catch (cause) { if (isAbortError(cause)) throw cause; throw networkError(); }
}
export async function runtimeAction(path: string, body?: unknown, method: 'POST' | 'PUT' | 'DELETE' = 'POST'): Promise<void> {
  const serialized = requestBody(body);
  await checkedFetch(path, { method, headers: headers(), ...(serialized === undefined ? {} : { body: serialized }) });
}
export async function watchRun(id: string, signal: AbortSignal, emit: (event: RunEvent) => void): Promise<void> {
  const response = await checkedFetch(`runs/${encodeURIComponent(id)}/events`, { headers: headers(), signal });
  if (!response.body) throw new RuntimeRequestError('stream_unavailable', '管理服务未返回事件流。请刷新执行记录确认最新状态。', { status: response.status });
  const reader = response.body.getReader(); const decoder = new TextDecoder(); let pending = '';
  try {
    while (true) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try { chunk = await reader.read(); } catch (cause) { if (isAbortError(cause)) throw cause; throw networkError(); }
      if (chunk.done) return;
      pending += decoder.decode(chunk.value, { stream: true }); pending = pending.replaceAll('\r\n', '\n');
      let boundary = pending.indexOf('\n\n');
      while (boundary >= 0) {
        const block = pending.slice(0, boundary); pending = pending.slice(boundary + 2);
        const payload = block.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
        if (payload) {
          let raw: unknown;
          try { raw = JSON.parse(payload); }
          catch { throw new RuntimeRequestError('invalid_json', '执行事件格式无法读取，请刷新执行记录确认最新状态。', { status: response.status }); }
          emit(parseResponse(raw, RunEventSchema, response.status));
        }
        boundary = pending.indexOf('\n\n');
      }
    }
  } finally { reader.releaseLock(); }
}
export async function downloadRuntimeArtifact(id:string,name:string):Promise<void>{ return downloadRuntimeFile(`artifacts/${encodeURIComponent(id)}`,name); }
export async function downloadRuntimeFile(route:string,name:string):Promise<void>{
  const response=await checkedFetch(route,{headers:headers()});
  let blob: Blob;
  try { blob = await response.blob(); } catch(cause) { if (isAbortError(cause)) throw cause; throw networkError(); }
  const url=URL.createObjectURL(blob);
  const link=document.createElement('a');
  link.href=url;link.download=name.replace(/[\\/:*?"<>|]/g,'_').slice(0,255)||'artifact';
  link.click();window.setTimeout(()=>URL.revokeObjectURL(url),1000);
}
