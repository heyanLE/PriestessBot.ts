import { request } from './dashboard';
export interface ExecutionSummary {
  id: string;
  status: 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED' | 'SKIPPED';
  platform: string;
  sessionId: string;
  messageId: string;
  senderId: string;
  workspaceId: string;
  agent: string;
  provider: string;
  model: string;
  inputPreview: string;
  outputPreview: string;
  startedAt: number;
  finishedAt?: number;
  durationMillis?: number;
  eventCount: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  error?: string;
}
export interface ExecutionEvent {
  executionId: string;
  seq: number;
  category: 'IM' | 'AGENT' | 'LLM' | 'TOOL';
  type: string;
  step?: number;
  timestamp: number;
  durationMillis?: number;
  data: Record<string, unknown>;
  truncated: boolean;
}
export interface ExecutionDetail {
  execution: ExecutionSummary;
  events: ExecutionEvent[];
  nextSeq: number;
  hasMore: boolean;
}
export interface ExecutionPage {
  items: ExecutionSummary[];
  total: number;
  limit: number;
  offset: number;
}
export const executionsApi = {
  list: (filters: Record<string, string | number>) =>
    request<ExecutionPage>(
      `/api/executions?${new URLSearchParams(
        Object.entries(filters)
          .filter(([, value]) => String(value).length > 0)
          .map(([key, value]) => [key, String(value)]),
      )}`,
    ),
  detail: (id: string, afterSeq = 0) =>
    request<ExecutionDetail>(
      `/api/executions/${encodeURIComponent(id)}?afterSeq=${afterSeq}&limit=100`,
    ),
};
