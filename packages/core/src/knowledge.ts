import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { KnowledgeDocumentSchema, type AgentDefinition, type KnowledgeDocument, type KnowledgeHit, type RunContext } from '../../contracts/src/index.js';
import type { AuthorizationService } from './authorization.js';
import type { RuntimeStore } from './storage.js';

const ChunkSchema = z.object({ id: z.string(), libraryId: z.string(), documentId: z.string(), documentName: z.string(), version: z.number().int(), text: z.string(), page: z.number().int().optional(), vector: z.array(z.number().finite()), embeddingModel: z.string(), dimensions: z.number().int() });
type Chunk = z.infer<typeof ChunkSchema>;
export interface EmbeddingProvider { readonly model: string; readonly dimensions: number; embed(texts: readonly string[], signal: AbortSignal): Promise<readonly (readonly number[])[]>; }
export interface KnowledgeReranker { rerank(query: string, hits: readonly KnowledgeHit[], signal: AbortSignal): Promise<readonly KnowledgeHit[]>; }
export interface ParsedPage { readonly text: string; readonly page?: number; }
export interface DocumentParser { parse(data: Uint8Array, mimeType: KnowledgeDocument['mimeType'], signal: AbortSignal): Promise<readonly ParsedPage[]>; }
function tokens(text: string): string[] { return text.toLowerCase().match(/[a-z0-9_]+|[\p{Script=Han}]/gu) ?? []; }
function cosine(left: readonly number[], right: readonly number[]): number {
  if (left.length !== right.length) throw new Error('Embedding dimension mismatch');
  let dot = 0; let a = 0; let b = 0;
  for (let index = 0; index < left.length; index += 1) { const x = left[index] ?? 0; const y = right[index] ?? 0; dot += x * y; a += x * x; b += y * y; }
  return a === 0 || b === 0 ? 0 : dot / Math.sqrt(a * b);
}
/** Deterministic local baseline; replace with a semantic embedding provider for semantic retrieval. */
export class LocalHashEmbedding implements EmbeddingProvider {
  readonly model = 'local-token-hash-v1'; readonly dimensions = 256;
  embed(texts: readonly string[], signal: AbortSignal): Promise<readonly (readonly number[])[]> {
    signal.throwIfAborted();
    return Promise.resolve(texts.map(text => { const vector = Array.from({ length: this.dimensions }, () => 0); for (const token of tokens(text)) { let hash = 2166136261; for (const character of token) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619); const index = (hash >>> 0) % this.dimensions; vector[index] = (vector[index] ?? 0) + 1; } return vector; }));
  }
}
export class KnowledgeService {
  constructor(private readonly store: RuntimeStore, private readonly auth: AuthorizationService, private readonly embedding: EmbeddingProvider = new LocalHashEmbedding(), private readonly reranker?: KnowledgeReranker) {}
  documents(): KnowledgeDocument[] { return this.store.list('knowledge-documents', KnowledgeDocumentSchema); }
  async importDocument(context: RunContext, agent: AgentDefinition, input: { libraryId: string; name: string; mimeType: KnowledgeDocument['mimeType']; pages: readonly ParsedPage[]; documentId?: string }): Promise<KnowledgeDocument> {
    this.auth.assert(context, 'resources.manage', agent, { kind: 'knowledgeLibraries', id: input.libraryId });
    const existing = input.documentId === undefined ? undefined : this.store.get('knowledge-documents', input.documentId, KnowledgeDocumentSchema);
    if (existing !== undefined && existing.libraryId !== input.libraryId) throw new Error('Cannot move a document between libraries');
    const now = Date.now();
    const document: KnowledgeDocument = { id: existing?.id ?? randomUUID(), libraryId: input.libraryId, name: input.name, mimeType: input.mimeType, version: (existing?.version ?? 0) + 1, status: 'indexing', chunkCount: 0, createdAt: existing?.createdAt ?? now, updatedAt: now };
    this.store.put('knowledge-documents', document.id, document);
    // Retained source is bounded and supports deterministic rebuild/retry after index changes.
    try {
      if (input.pages.reduce((size, page) => size + page.text.length, 0) > 5_000_000) throw new Error('Document exceeds import budget');
      this.store.put('knowledge-source', document.id, input.pages);
      const pieces: { text: string; page?: number }[] = [];
      for (const page of input.pages) for (let offset = 0; offset < page.text.length; offset += 1000) { const text = page.text.slice(offset, offset + 1200); if (text.trim()) pieces.push(page.page === undefined ? { text } : { text, page: page.page }); }
      const vectors = await this.embedding.embed(pieces.map(piece => piece.text), context.signal);
      if (vectors.length !== pieces.length) throw new Error('Embedding count mismatch');
      this.auth.assert(context, 'resources.manage', agent, { kind: 'knowledgeLibraries', id: input.libraryId });
      const current = this.store.get('knowledge-documents', document.id, KnowledgeDocumentSchema);
      if (current === undefined || current.version !== document.version || current.status !== 'indexing') throw new Error('Import was deleted or superseded');
      const chunks: Chunk[] = pieces.map((piece, index) => ChunkSchema.parse({ ...piece, id: `${document.id}:${document.version}:${index}`, libraryId: document.libraryId, documentId: document.id, documentName: document.name, version: document.version, vector: vectors[index], embeddingModel: this.embedding.model, dimensions: this.embedding.dimensions }));
      if (chunks.some(chunk => chunk.vector.length !== this.embedding.dimensions)) throw new Error('Embedding dimension mismatch');
      this.store.db.exec('BEGIN IMMEDIATE');
      try { this.deleteChunks(document.id); for (const chunk of chunks) this.store.put('knowledge-chunks', chunk.id, chunk); const ready: KnowledgeDocument = { ...document, status: 'ready', chunkCount: chunks.length, updatedAt: Date.now() }; this.store.put('knowledge-documents', document.id, ready); this.store.db.exec('COMMIT'); return ready; }
      catch (error) { this.store.db.exec('ROLLBACK'); throw error; }
    } catch (error) {
      const failed: KnowledgeDocument = { ...document, status: 'failed', error: error instanceof Error ? error.message : 'Indexing failed', updatedAt: Date.now() };
      const current = this.store.get('knowledge-documents', document.id, KnowledgeDocumentSchema);
      if (current?.version === document.version && current.status === 'indexing') this.store.put('knowledge-documents', document.id, failed);
      return failed;
    }
  }
  async search(context: RunContext, agent: AgentDefinition, query: string, limit = 6): Promise<KnowledgeHit[]> {
    this.auth.assert(context, 'knowledge.read', agent);
    const ready = new Set(this.documents().filter(document => document.status === 'ready').map(document => document.id));
    const chunks = this.store.list('knowledge-chunks', ChunkSchema).filter(chunk => context.resources.knowledgeLibraries.includes(chunk.libraryId) && ready.has(chunk.documentId));
    if (chunks.some(chunk => chunk.embeddingModel !== this.embedding.model || chunk.dimensions !== this.embedding.dimensions)) throw new Error('Knowledge index requires rebuild for current embedding model');
    const queryVector = (await this.embedding.embed([query], context.signal))[0];
    if (queryVector === undefined || queryVector.length !== this.embedding.dimensions) throw new Error('Invalid query embedding');
    const terms = tokens(query); const rankedSparse = chunks.map(chunk => ({ chunk, score: terms.reduce((total, term) => total + (chunk.text.toLowerCase().includes(term) ? 1 : 0), 0) })).filter(item => item.score > 0).sort((a, b) => b.score - a.score);
    const rankedDense = chunks.map(chunk => ({ chunk, score: cosine(chunk.vector, queryVector) })).filter(item => item.score > 0).sort((a, b) => b.score - a.score);
    const scores = new Map<string, number>();
    for (const ranking of [rankedSparse, rankedDense]) ranking.forEach((item, index) => scores.set(item.chunk.id, (scores.get(item.chunk.id) ?? 0) + 1 / (60 + index + 1)));
    const hits: KnowledgeHit[] = chunks.filter(chunk => scores.has(chunk.id)).map(chunk => ({ id: chunk.id, libraryId: chunk.libraryId, documentId: chunk.documentId, documentName: chunk.documentName, version: chunk.version, text: chunk.text, ...(chunk.page === undefined ? {} : { page: chunk.page }), score: scores.get(chunk.id) ?? 0 })).sort((a, b) => b.score - a.score).slice(0, Math.max(1, Math.min(50, limit * 3)));
    const ranked = this.reranker === undefined ? hits : await this.reranker.rerank(query, hits, context.signal);
    this.auth.assert(context, 'knowledge.read', agent);
    const currentDocuments = new Map(this.documents().filter(document => document.status === 'ready').map(document => [document.id, document.version]));
    const allowed = new Map(hits.filter(hit => currentDocuments.get(hit.documentId) === hit.version).map(hit => [hit.id, hit]));
    // Rerankers may reorder existing authorized hits, never introduce external text or IDs.
    return ranked.flatMap(hit => { const canonical = allowed.get(hit.id); return canonical === undefined ? [] : [canonical]; }).slice(0, Math.max(0, Math.min(30, limit)));
  }
  async rebuild(context: RunContext, agent: AgentDefinition, id: string): Promise<KnowledgeDocument> {
    const document = this.store.get('knowledge-documents', id, KnowledgeDocumentSchema);
    const pages = this.store.get('knowledge-source', id, z.array(z.object({ text: z.string(), page: z.number().int().optional() })));
    if (document === undefined || pages === undefined) throw new Error('Document source not found');
    return this.importDocument(context, agent, { libraryId: document.libraryId, name: document.name, mimeType: document.mimeType, pages: pages.map(page => page.page === undefined ? { text: page.text } : { text: page.text, page: page.page }), documentId: id });
  }
  delete(context: RunContext, agent: AgentDefinition, id: string): void {
    const document = this.store.get('knowledge-documents', id, KnowledgeDocumentSchema);
    if (document === undefined) throw new Error('Document not found');
    this.auth.assert(context, 'resources.manage', agent, { kind: 'knowledgeLibraries', id: document.libraryId });
    this.store.db.exec('BEGIN IMMEDIATE');
    try { this.deleteChunks(id); this.store.delete('knowledge-source', id); this.store.delete('knowledge-documents', id); this.store.db.exec('COMMIT'); } catch (error) { this.store.db.exec('ROLLBACK'); throw error; }
  }
  private deleteChunks(id: string): void { for (const chunk of this.store.list('knowledge-chunks', ChunkSchema)) if (chunk.documentId === id) this.store.delete('knowledge-chunks', chunk.id); }
}
