import type { Grant } from '../../../../typescript/packages/contracts/src/index';

/** Keep platform IDs as exact strings, including leading zeroes and letter case. */
export function parseSenderIds(text: string): string[] {
  return [...new Set(text.split(/[\s,，;；]+/u).map(value => value.trim()).filter(Boolean))];
}

export function senderScopeLabel(grant: Pick<Grant, 'sessionId' | 'sessionType'>): string {
  if (grant.sessionId) return `${grant.sessionType === 'group' ? '群聊' : grant.sessionType === 'private' ? '私聊' : '会话'} ${grant.sessionId}`;
  if (grant.sessionType === 'group') return '仅群聊';
  if (grant.sessionType === 'private') return '仅私聊';
  return '该机器人全部会话';
}

export interface SenderAuthorizationConflict { readonly senderId: string; readonly platform: string; readonly firstIndex: number; readonly secondIndex: number; }
export function senderAuthorizationConflicts(grants: readonly Grant[]): SenderAuthorizationConflict[] {
  const previous = new Map<string, { state: Grant['state']; index: number }>();
  const conflicts: SenderAuthorizationConflict[] = [];
  grants.forEach((grant, index) => {
    for (const senderId of new Set(grant.senderIds)) {
      if (!senderId || !grant.platform) continue;
      const key = JSON.stringify([grant.platform, grant.sessionType ?? null, grant.sessionId ?? null, senderId]);
      const existing = previous.get(key);
      if (existing && existing.state !== grant.state) conflicts.push({ senderId, platform: grant.platform, firstIndex: existing.index, secondIndex: index });
      else if (!existing) previous.set(key, { state: grant.state, index });
    }
  });
  return conflicts;
}
