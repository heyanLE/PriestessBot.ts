import type { HostedTool, ModelSettings } from '@openai/agents';
import type { RuntimeConfig } from '../../../contracts/src/index.js';
import { ModelServerToolSchema } from '../../../contracts/src/model-parameters.js';

type Connection = RuntimeConfig['connections'][number];

export function customModelSettings(connection: Connection | undefined): ModelSettings {
  if (!connection?.customParameters) return {};
  const providerData = { ...connection.customParameters };
  delete providerData['tools'];
  return { providerData };
}

/** SDK serializes these alongside the authorized local tools, never instead of them. */
export function customModelTools(connection: Connection | undefined): HostedTool[] {
  const definitions = connection?.customParameters?.['tools'];
  if (!Array.isArray(definitions) || connection?.protocol !== 'responses') return [];
  return definitions.map(value => {
    const definition = ModelServerToolSchema.parse(value);
    return { type: 'hosted_tool', name: definition.type, providerData: definition };
  });
}
