import { z } from 'zod';

// These fields belong to the runtime, not provider-specific request options.
const reserved = new Set(['model', 'input', 'messages', 'instructions', 'stream', 'stream_options', 'max_tokens', 'max_completion_tokens', 'max_output_tokens', 'tool_choice', 'previous_response_id', 'conversation', 'extra_body', 'extraBody', 'extra_headers', 'extraHeaders', 'extra_query', 'extraQuery', 'fetch', 'api_key', 'apiKey', '__proto__', 'constructor', 'prototype']);
export const ModelServerToolSchema = z.object({ type: z.string().min(1) }).catchall(z.json()).refine(tool => !['function', 'custom'].includes(tool.type), 'Custom parameters accept server tools only; configure local tools on the Agent.');
export const ModelCustomParametersSchema = z.record(z.string(), z.json()).superRefine((parameters, context) => {
  for (const key of Object.keys(parameters)) if (reserved.has(key)) context.addIssue({ code: 'custom', path: [key], message: `Parameter ${key} is managed by the runtime.` });
  if (parameters['tools'] !== undefined) {
    const result = z.array(ModelServerToolSchema).safeParse(parameters['tools']);
    if (!result.success) context.addIssue({ code: 'custom', path: ['tools'], message: 'tools must be an array of server tool definitions with a type.' });
    else if (new Set(result.data.map(tool => tool.type)).size !== result.data.length) context.addIssue({ code: 'custom', path: ['tools'], message: 'Server tool types must be unique.' });
  }
});
