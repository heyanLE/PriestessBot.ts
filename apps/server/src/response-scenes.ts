import { fileURLToPath } from 'node:url';
import type { EngineInput } from '../../../packages/contracts/src/index.js';
import type { PluginSettings } from './plugin-settings.js';

export function responseSceneLibraries(settings: PluginSettings, input: EngineInput) {
  const record = settings.get('response_scenes');
  if (record.id !== 'response_scenes' || !record.settings.enabled || !input.context.resources.tools.includes('read_skill') || !input.context.effectiveCapabilities.includes('files.read')) return [];
  if (record.settings.agentIds.length && !record.settings.agentIds.includes(input.agent.id)) return [];
  const root = new URL(import.meta.url.endsWith('.ts') ? '../../../' : '../../../../', import.meta.url);
  return [{ id: 'plugin-response-scenes', directory: fileURLToPath(new URL('resources/plugins/response-scenes/skills/', root)) }];
}
