import { request, type ConfigurationDiagnostic } from './dashboard';
import type { AgentTypeView, ApplicationConfig, PermissionGroup, ProviderProtocolView } from '../models/configV3';
export interface ConfigSnapshot {
  document: ApplicationConfig | null;
  revision: string | null;
  sourcePath: string;
  diagnostics: ConfigurationDiagnostic[];
}
export interface ConfigResult {
  success: boolean;
  diagnostics: ConfigurationDiagnostic[];
  activeVersion?: number;
  pendingRestartPaths?: string[];
}
export interface SkillItem {
  name: string;
  description: string;
  source: 'PLATFORM' | 'CONFIGURATION' | 'TEMPORARY';
  libraryId?: string | null;
  path: string;
  permissionGroup: PermissionGroup;
  enabled: boolean;
}
export interface SkillsResponse {
  items: SkillItem[];
  diagnostics: Array<string | ConfigurationDiagnostic>;
}
export interface SkillDocument {
  name: string;
  content: string;
  path: string;
}
export interface RouteTest {
  sessionType: string;
  text: string;
  mentionsBot: boolean;
  mentionsAny: boolean;
  replyToBot: boolean;
  hasReply: boolean;
  senderId: string;
}
export interface RouteResult {
  matched: boolean;
  routeId?: string;
  action?: string | { type: string; agentId?: string };
  agentId?: string;
  normalizedText: string;
  permissionGroup: string;
}
const json = (method: string, value: unknown) => ({ method, body: JSON.stringify(value) });export const configV3Api = {
  read: () => request<ConfigSnapshot>('/api/config/v3'),
  /** Agent type capabilities come from the runtime registry. */
  agentTypes: () => request<AgentTypeView[]>('/api/agent-types'),
  providerProtocols: () => request<ProviderProtocolView[]>('/api/provider-protocols'),
  /** Accepted compression strategy values, likewise from the runtime. */
  compressionStrategies: () => request<string[]>('/api/compression-strategies'),
  preview: (content: string) =>
    request<ConfigResult>('/api/config/v3/preview', json('POST', { content })),
  save: (content: string, expectedRevision: string) =>
    request<ConfigResult>('/api/config/v3', json('PUT', { content, expectedRevision })),
  reload: () => request<ConfigResult>('/api/config/v3/reload', json('POST', {})),
  routeTest: (id: string, input: RouteTest) =>
    request<RouteResult>(`/api/ims/${encodeURIComponent(id)}/route-test`, json('POST', input)),
  skills: (kind: 'agents' | 'skill-libraries', id: string) =>
    request<SkillsResponse>(`/api/${kind}/${encodeURIComponent(id)}/skills`),
  skillDocument: (
    kind: 'agents' | 'skill-libraries',
    id: string,
    item: Pick<SkillItem, 'name' | 'source' | 'libraryId'>,
  ) =>
    request<SkillDocument>(
      `/api/${kind}/${encodeURIComponent(id)}/skills/document?${new URLSearchParams({ name: item.name, source: item.source, ...(item.libraryId ? { libraryId: item.libraryId } : {}) })}`,
    ),
  saveSkill: (
    kind: 'agents' | 'skill-libraries',
    id: string,
    input: { name: string; content: string; source: string; libraryId?: string | null },
  ) =>
    request<SkillDocument>(
      `/api/${kind}/${encodeURIComponent(id)}/skills`,
      json(
        'PUT',
        kind === 'skill-libraries' ? { name: input.name, content: input.content } : input,
      ),
    ),
};
