import { z } from 'zod';

/** Chat Completions-compatible providers may reject json_schema response_format.
 * Ask for plain JSON and keep the same strict host validation boundary instead. */
export function memoryJsonInstructions(schema: z.ZodType): string {
  return `Return only one JSON object matching this exact JSON schema, without Markdown fences or explanation: ${JSON.stringify(z.toJSONSchema(schema))}`;
}
export function parseMemoryOutput<T>(value: unknown, schema: z.ZodType<T>): T {
  if (typeof value !== 'string') return schema.parse(value);
  if (value.length > 50_000) throw new Error('Memory model output exceeds validation limit');
  const raw: unknown = JSON.parse(value.trim());
  return schema.parse(raw);
}
