import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import { AgentDraftTestSchema, AgentWorkbenchSaveSchema } from '../../../packages/contracts/src/agent-workbench.js';
import { ManagementError } from '../../../packages/core/src/management.js';
import { DraftTestError } from './agent-draft-test.js';
import { agentCapabilities } from './agent-capabilities.js';
import type { PriestessRuntime } from './runtime.js';

interface Context { runtime: PriestessRuntime; request: IncomingMessage; response: ServerResponse; url: URL; body: (request: IncomingMessage) => Promise<unknown>; json: (response: ServerResponse, status: number, value: unknown) => void; }
export async function handleAgentWorkbenchHttp(context: Context): Promise<boolean> {
  const { runtime, request, response, url, body, json } = context;
  const [resource, id, action, extra] = url.pathname.slice('/api/ts/'.length).split('/').map(decodeURIComponent);
  const catalogue = resource === 'agent-capabilities' && id === undefined || resource === 'agents' && id === 'capabilities' && action === undefined;
  if (!catalogue && !(resource === 'agents' && id && (action === 'draft-test' || action === 'workbench') && extra === undefined)) return false;
  try {
    if (catalogue && request.method === 'GET') { json(response, 200, agentCapabilities(runtime)); return true; }
    if (action === 'workbench' && request.method === 'PUT') {
      const data = AgentWorkbenchSaveSchema.parse(await body(request)); if (data.agent.id !== id) throw new DraftTestError(400, 'Agent ID does not match route');
      json(response, 200, await runtime.saveAgentWorkbench(data)); return true;
    }
    if (action === 'draft-test' && request.method === 'POST') {
      const data = AgentDraftTestSchema.parse(await body(request)); if (data.agentId !== id) throw new DraftTestError(400, 'Agent ID does not match route');
      const controller = new AbortController(); const abort = (): void => { controller.abort(); }; const close = (): void => { if (!response.writableEnded) controller.abort(); };
      request.once('aborted', abort); response.once('close', close);
      try { const result = await runtime.draftTester.run(data, controller.signal); if (!response.destroyed) json(response, 200, result); }
      finally { request.off('aborted', abort); response.off('close', close); }
      return true;
    }
    json(response, 405, { error: 'Unsupported Agent workbench operation' });
  } catch (error) {
    if (error instanceof DraftTestError || error instanceof ManagementError) json(response, error.status, { error: error.message });
    else if (error instanceof z.ZodError) json(response, 400, { error: 'Invalid Agent workbench request' });
    else throw error;
  }
  return true;
}
