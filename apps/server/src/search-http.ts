import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import { AgentDefinitionSchema, type AgentDefinition, type RuntimeConfig } from '../../../packages/contracts/src/index.js';
import { EffectivePromptSchema, SearchConfigurationSchema } from '../../../packages/contracts/src/search.js';
import type { ManagementService } from '../../../packages/core/src/management.js';
import { SearchError, type WebSearchService } from '../../../packages/adapters/src/search/index.js';
import { assembleRootInstructions, synchronizePersonaAnchors } from '../../../packages/adapters/src/agents/prompt-context.js';
export function effectivePrompt(management: ManagementService, agent: AgentDefinition) {
  const binding = management.bindings().find(item => item.agentId === agent.id); const persona = management.personas().find(item => item.id === binding?.personaId); const resolved = management.resolveAgent(agent);
  return EffectivePromptSchema.parse({ agentId: agent.id, source: persona ? 'persona_library' : 'inline', personaId: persona?.id ?? null, personaName: persona?.name ?? null, supplementalInstructions: resolved.instructions, personaInstructions: resolved.persona, exampleDialogs: resolved.exampleDialogs, tools: resolved.resources.tools, skills: resolved.skillAllowlist, customErrorMessage: resolved.customErrorMessage, voicePrompt: resolved.voicePrompt, systemPrompt: assembleRootInstructions(resolved.instructions), contextMessages: synchronizePersonaAnchors([], resolved, 0), dynamicContextNote: '这里显示当前配置生成的固定结构。人格和示例以独立的 user 上下文消息提供；未改变的版本会从会话中复用，不会每轮重复追加。实际请求还会加入会话历史、当前消息、附件、记忆、知识、Skill 目录和获准工具。请在 Agent 记录中查看具体模型调用。' });
}
interface SearchHttpContext { service: WebSearchService; management: ManagementService; config: () => RuntimeConfig; request: IncomingMessage; response: ServerResponse; url: URL; body: (request: IncomingMessage) => Promise<unknown>; json: (response: ServerResponse, status: number, value: unknown) => void; }
/** Must run behind the shared management authentication guard. */
export async function handleSearchHttp(context: SearchHttpContext): Promise<boolean> {
  const { service, management, config, request, response, url, body, json } = context; const [resource, id, action] = url.pathname.slice('/api/ts/'.length).split('/').map(decodeURIComponent);
  if (resource !== 'search' && !(resource === 'agents' && id && action === 'effective-prompt')) return false;
  try {
    if (resource === 'search' && !id && request.method === 'GET') json(response, 200, service.status());
    else if (resource === 'search' && !id && request.method === 'PUT') { const input = SearchConfigurationSchema.extend({ expectedRevision: z.number().int().nonnegative() }).parse(await body(request)); const { expectedRevision, ...settings } = input; service.update(settings, expectedRevision); json(response, 200, service.status()); }
    else if (resource === 'agents' && id && (request.method === 'GET' || request.method === 'POST')) { const agent = request.method === 'POST' ? AgentDefinitionSchema.parse(await body(request)) : config().agents.find(item => item.id === id); if (!agent || agent.id !== id) throw new SearchError(404, 'Agent not found'); json(response, 200, effectivePrompt(management, agent)); }
    else json(response, 405, { error: 'Unsupported search operation' });
  } catch (error) { if (error instanceof SearchError) json(response, error.status, { error: error.message }); else if (error instanceof z.ZodError) json(response, 400, { error: 'Invalid search or prompt configuration' }); else throw error; }
  return true;
}
