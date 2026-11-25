export class QueueFullError extends Error { readonly code = 'queue_full'; }
interface QueueItem { readonly execute: (signal: AbortSignal) => Promise<void>; readonly reject: (error: Error) => void; readonly controller: AbortController; readonly owner: string | undefined; readonly runId: string | undefined; }
/** One active turn per conversation, with bounded global queue and independent controls. */
export class ConversationScheduler {
  private readonly queues = new Map<string, QueueItem[]>();
  private readonly active = new Map<string, QueueItem>();
  private readonly controls = new Map<string, AbortController>();
  private closing = false;
  constructor(private concurrency = 4, private perSessionLimit = 16, private globalQueueLimit = 256) {
    this.configure(concurrency, perSessionLimit, globalQueueLimit);
  }
  /** New bounds affect admission and dispatch without dropping already admitted work. */
  configure(concurrency: number, perSessionLimit: number, globalQueueLimit: number): void {
    if (![concurrency, perSessionLimit, globalQueueLimit].every(value => Number.isSafeInteger(value) && value >= 1)) throw new Error('Invalid scheduler bounds');
    this.concurrency = concurrency; this.perSessionLimit = perSessionLimit; this.globalQueueLimit = globalQueueLimit;
    this.pump();
  }
  enqueue<T>(session: string, task: (signal: AbortSignal) => Promise<T>, owner?: string, runId?: string): Promise<T> {
    if (this.closing) return Promise.reject(new Error('Scheduler is draining'));
    const queue = this.queues.get(session) ?? [];
    if (queue.length >= this.perSessionLimit || this.pending >= this.globalQueueLimit) return Promise.reject(new QueueFullError('Conversation queue is full'));
    return new Promise<T>((resolve, reject: (reason: Error) => void) => {
      const item: QueueItem = { controller: new AbortController(), owner, runId, reject, execute: async signal => { try { resolve(await task(signal)); } catch (error) { reject(error instanceof Error ? error : new Error('Task failed')); } } };
      queue.push(item); this.queues.set(session, queue); this.pump();
    });
  }
  get pending(): number { return [...this.queues.values()].reduce((total, queue) => total + queue.length, 0); }
  get running(): number { return this.active.size; }
  async runControl<T>(runId: string, task: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (this.closing) throw new Error('Scheduler is draining');
    const controller = new AbortController();
    this.controls.set(runId, controller);
    try { return await task(controller.signal); }
    finally { this.controls.delete(runId); }
  }
  cancelRun(session: string, runId: string, reason: string): void {
    this.controls.get(runId)?.abort(new Error(reason));
    this.cancelMatching(session, reason, item => item.runId === runId);
  }
  cancel(session: string, reason = 'Stopped by user', owner?: string): void {
    this.cancelMatching(session, reason, item => owner === undefined || item.owner === owner);
  }
  private cancelMatching(session: string, reason: string, matches: (item: QueueItem) => boolean): void {
    const active = this.active.get(session);
    if (active && matches(active)) active.controller.abort(new Error(reason));
    const retained: QueueItem[] = [];
    for (const item of this.queues.get(session) ?? []) {
      if (!matches(item)) { retained.push(item); continue; }
      item.controller.abort(new Error(reason)); item.reject(new Error(reason));
    }
    if (retained.length === 0) this.queues.delete(session);
    else this.queues.set(session, retained);
  }
  async shutdown(timeoutMs = 5000): Promise<void> {
    this.closing = true;
    for (const controller of this.controls.values()) controller.abort(new Error('Runtime shutdown'));
    for (const session of new Set([...this.queues.keys(), ...this.active.keys()])) this.cancel(session, 'Runtime shutdown');
    const deadline = Date.now() + timeoutMs;
    while (this.active.size > 0 && Date.now() < deadline) await new Promise<void>(resolve => setTimeout(resolve, 10));
    if (this.active.size > 0) throw new Error('Timed out waiting for cancelled work');
  }
  private pump(): void {
    for (const [session, queue] of this.queues) {
      if (this.active.size >= this.concurrency) break;
      if (this.active.has(session)) continue;
      const item = queue.shift();
      if (queue.length === 0) this.queues.delete(session);
      if (item === undefined) continue;
      this.active.set(session, item);
      void item.execute(item.controller.signal).finally(() => { this.active.delete(session); this.pump(); });
    }
  }
}
