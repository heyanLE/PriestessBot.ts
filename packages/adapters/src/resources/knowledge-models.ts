import { z } from 'zod';
import type { EmbeddingProvider, KnowledgeReranker } from '../../../core/src/knowledge.js';
import type { KnowledgeHit } from '../../../contracts/src/index.js';

const EmbeddingsResponse = z.object({ data: z.array(z.object({ index: z.number().int().nonnegative(), embedding: z.array(z.number().finite()) })) });
export class HttpEmbeddingProvider implements EmbeddingProvider {
  constructor(readonly model: string, readonly dimensions: number, private readonly baseUrl: string, private readonly apiKey: string) {}
  async embed(texts: readonly string[], signal: AbortSignal): Promise<readonly (readonly number[])[]> {
    const result: number[][] = [];
    for (let offset = 0; offset < texts.length; offset += 32) {
      const batch = texts.slice(offset, offset + 32);
      const response = await fetch(`${this.baseUrl.replace(/\/$/, '')}/embeddings`, { method: 'POST', signal, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` }, body: JSON.stringify({ model: this.model, input: batch, dimensions: this.dimensions }) });
      if (!response.ok) throw new Error(`Embedding provider HTTP ${response.status}`);
      const body: unknown = await response.json();
      const vectors = EmbeddingsResponse.parse(body).data.sort((a, b) => a.index - b.index);
      if (vectors.length !== batch.length || vectors.some((item, index) => item.index !== index || item.embedding.length !== this.dimensions)) throw new Error('Embedding response shape mismatch');
      result.push(...vectors.map(item => item.embedding));
    }
    return result;
  }
}
const RerankResponse = z.object({ results: z.array(z.object({ index: z.number().int().nonnegative(), relevance_score: z.number().finite() })) });
export class HttpReranker implements KnowledgeReranker {
  constructor(private readonly endpoint: string, private readonly model: string, private readonly apiKey: string) {}
  async rerank(query: string, hits: readonly KnowledgeHit[], signal: AbortSignal): Promise<readonly KnowledgeHit[]> {
    if (!hits.length) return [];
    const response = await fetch(this.endpoint, { method: 'POST', signal, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` }, body: JSON.stringify({ model: this.model, query, documents: hits.map(hit => hit.text) }) });
    if (!response.ok) throw new Error(`Reranker HTTP ${response.status}`);
    const body: unknown = await response.json();
    const seen = new Set<number>();
    return RerankResponse.parse(body).results.flatMap(item => { const hit = hits[item.index]; if (!hit || seen.has(item.index)) return []; seen.add(item.index); return [{ ...hit, score: item.relevance_score }]; });
  }
}
