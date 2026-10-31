import { getAllMcpTools, MCPServerStdio, MCPServerSSE, MCPServerStreamableHttp, type MCPServer, type Tool } from '@openai/agents';
import { randomUUID } from 'node:crypto';
import type { EngineInput, RunEvent, RuntimeConfig } from '../../../contracts/src/index.js';
import type { AuthorizationService } from '../../../core/src/authorization.js';
import type { RuntimeStore } from '../../../core/src/storage.js';
import type { SdkLocalContext } from './engine.js';

/** One connection set per run; no mutable tool authorization is shared across callers. */
export class McpConnections {
  private readonly active = new Map<string, MCPServer[]>();
  constructor(private readonly config: () => RuntimeConfig, private readonly auth: AuthorizationService, private readonly store: RuntimeStore, private readonly secret: (key: string) => string | undefined) {}
  async tools(input: EngineInput, emit: (event: RunEvent) => void): Promise<Tool<SdkLocalContext>[]> {
    if (!input.context.effectiveCapabilities.includes('external.write')) return [];
    const servers: MCPServer[] = []; const output: Tool<SdkLocalContext>[] = [];
    this.active.set(input.context.runId, servers);
    try {
      for (const definition of this.config().mcpServers.filter(item => input.context.resources.mcpServers.includes(item.id))) {
        this.auth.assert(input.context, 'external.write', input.agent, { kind: 'mcpServers', id: definition.id });
        const env: Record<string, string> = { PATH: '/usr/local/bin:/usr/bin:/bin' };
        for (const [key, reference] of Object.entries(definition.envRefs)) { const value = this.secret(reference); if (value === undefined) throw new Error('MCP credential reference unavailable'); env[key] = value; }
        const headers: Record<string, string> = {};
        for (const [key, reference] of Object.entries(definition.headersEnv)) { const value = this.secret(reference); if (value === undefined) throw new Error('MCP header credential unavailable'); headers[key] = value; }
        let server: MCPServer;
        if (definition.transport === 'stdio') {
          if (!definition.command) throw new Error('MCP command missing');
          server = new MCPServerStdio({ command: definition.command, args: definition.args, env, name: definition.id, cacheToolsList: false, maxListPages: 4, timeout: 30_000 });
        } else {
          if (!definition.url) throw new Error('MCP URL missing');
          const options = { url: definition.url, requestInit: { headers }, name: definition.id, cacheToolsList: false, maxListPages: 4, timeout: 30_000 };
          server = definition.transport === 'sse' ? new MCPServerSSE(options) : new MCPServerStreamableHttp(options);
        }
        servers.push(server);
        await server.connect();
        input.context.signal.throwIfAborted();
        const tools = await getAllMcpTools<SdkLocalContext>({ mcpServers: [server], includeServerInToolNames: true, convertSchemasToStrict: true, errorFunction: null });
        for (const entry of tools) {
          if (entry.type !== 'function' || !input.context.resources.tools.includes(entry.name)) continue;
          const wrapped: Tool<SdkLocalContext> = { ...entry,
            needsApproval: input.agent.approvalTools.includes(entry.name) ? () => Promise.resolve(true) : entry.needsApproval,
            invoke: async (sdk, argumentsText, detail) => {
            if (sdk.context.runId !== input.context.runId) throw new Error('MCP run context mismatch');
            this.auth.assert(input.context, 'external.write', input.agent, { kind: 'mcpServers', id: definition.id });
            this.auth.assert(input.context, 'external.write', input.agent, { kind: 'tools', id: entry.name });
            const callId = detail?.toolCall?.callId ?? randomUUID();
            if (!this.store.claimEvent(`mcp:${input.context.runId}:${callId}`, 86_400_000)) throw new Error('Duplicate MCP tool call');
            const event = (status: 'started' | 'completed' | 'failed'): void => emit({ type: 'tool', runId: input.context.runId, turnId: input.context.turnId, sequence: 0, timestamp: Date.now(), name: entry.name, callId, status, summary: '' });
            event('started');
            try {
              const result: unknown = await entry.invoke(sdk, argumentsText, { ...detail, signal: input.context.signal });
              this.auth.assert(input.context, 'external.write', input.agent, { kind: 'mcpServers', id: definition.id });
              event('completed');
              // SDK's converted MCP tools already materialize their multimodal result.
              return result;
            } catch { event('failed'); throw new Error('MCP call failed or authorization was revoked'); }
          } };
          output.push(wrapped);
        }
      }
      return output;
    } catch (error) { await this.close(input.context.runId); throw error; }
  }
  async close(runId: string): Promise<void> { const servers = this.active.get(runId) ?? []; this.active.delete(runId); await Promise.allSettled(servers.map(server => server.close())); }
  async stop(): Promise<void> { await Promise.all([...this.active.keys()].map(id => this.close(id))); }
}
