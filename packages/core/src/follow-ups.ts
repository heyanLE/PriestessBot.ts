import type { MessageEvent, RunContext } from '../../contracts/src/index.js';
import { principalKey } from './authorization.js';

/** A bounded mailbox owned by one active authority snapshot; never a second execution queue. */
export class FollowUpMailbox {
  private readonly items: MessageEvent[] = [];
  private accepted = 0;
  private chars = 0;
  private open = true;
  constructor(readonly context: RunContext, private readonly assertCurrent: () => void, private readonly maxMessages = 8, private readonly maxChars = 64_000) {}
  offer(message: MessageEvent): boolean {
    if (!this.open || this.context.signal.aborted || principalKey(message) !== principalKey(this.context.principal)) return false;
    this.assertCurrent();
    const size = JSON.stringify(message).length;
    if (this.accepted >= this.maxMessages || this.chars + size > this.maxChars) return false;
    this.items.push(structuredClone(message)); this.accepted++; this.chars += size; return true;
  }
  take(): MessageEvent[] { this.assertCurrent(); return this.items.splice(0); }
  takeOrClose(): MessageEvent[] {
    this.assertCurrent();
    if (this.items.length === 0) { this.open = false; return []; }
    return this.items.splice(0);
  }
  close(): void { this.open = false; this.items.splice(0); }
}
