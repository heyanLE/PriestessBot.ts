import type { RuntimeState, NodeKind } from './rust-contracts.generated';
export type { RuntimeState, NodeKind };
export interface GraphNode { id: string; type: NodeKind; [key: string]: any }
export interface Graph { schema_version: number; id: string; revision: number; entry: string; nodes: GraphNode[]; edges: { from: string; port: string; to: string }[]; permissions?: any; limits?: any }
export type Layout = Record<string, { x: number; y: number }>;
let token = '';
export const authorize = (value: string) => { token = value; };
export async function request<T = any>(path: string, body?: unknown, method?: string): Promise<T> {
  const response = await fetch(`/api/v4/${path}`, { method: method || (body === undefined ? 'GET' : 'POST'), headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const value = await response.json();
  if (!response.ok) throw new Error(`${response.status}: ${value.error?.message || '请求失败'}`);
  return value;
}
export async function events(signal: AbortSignal, onEvent: (value: any) => void) {
  const response = await fetch('/api/v4/events', { headers: { Authorization: `Bearer ${token}` }, signal });
  if (!response.ok || !response.body) throw new Error('事件连接失败');
  const reader = response.body.getReader(); const decoder = new TextDecoder(); let pending = '';
  try { while (!signal.aborted) { const { value, done } = await reader.read(); if (done) break; pending += decoder.decode(value, { stream: true });
    let end; while ((end = pending.indexOf('\n\n')) >= 0) { const frame = pending.slice(0, end); pending = pending.slice(end + 2); const data = frame.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n'); if (data) onEvent(JSON.parse(data)); }
  } } finally { reader.releaseLock(); }
}
