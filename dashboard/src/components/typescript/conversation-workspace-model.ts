import type { Conversation } from '../../../../packages/contracts/src/management';

export interface ConversationFilters { platform: string; sessionType: 'all' | 'private' | 'group'; sessionId: string; agentId: string; archived: 'all' | 'active' | 'archived'; search: string; }
function text(value: unknown): string { return typeof value === 'string' ? value : ''; }
export function conversationFiltersFromQuery(query: Readonly<Record<string, unknown>>): ConversationFilters {
  const sessionType = text(query['sessionType']); const archived = text(query['archived']);
  return { platform:text(query['platform']), sessionType:sessionType === 'group' || sessionType === 'private' ? sessionType : 'all', sessionId:text(query['sessionId']), agentId:text(query['agent']), archived:archived === 'active' || archived === 'false' ? 'active' : archived === 'archived' || archived === 'true' ? 'archived' : 'all', search:text(query['search']) };
}
export function filterConversations(conversations: readonly Conversation[], filters: ConversationFilters): Conversation[] {
  return conversations.filter(conversation => (!filters.platform || conversation.platform === filters.platform) && (!filters.sessionId || conversation.sessionId === filters.sessionId) && (!filters.agentId || conversation.agentId === filters.agentId) && (filters.sessionType === 'all' || conversation.sessionType === filters.sessionType) && (filters.archived === 'all' || conversation.archived === (filters.archived === 'archived'))).sort((left,right) => right.updatedAt-left.updatedAt || left.id.localeCompare(right.id));
}
export function conversationOrigin(conversation: Pick<Conversation,'platform'|'platformType'>): string {
  return conversation.platform === 'dashboard' ? '控制台' : conversation.platformType === 'napcat' ? 'QQ / NapCat' : conversation.platformType === 'telegram' ? 'Telegram' : '微信';
}
