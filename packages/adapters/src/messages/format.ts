/** Split at Unicode code-point boundaries, respecting a transport's UTF-16 limit. */
export function paginate(text: string, limit: number): string[] {
  if (!Number.isInteger(limit) || limit < 2) throw new Error('Page limit must be at least two');
  const pages: string[] = [];
  let current = '';
  for (const char of text) {
    if (current.length + char.length > limit) { pages.push(current); current = ''; }
    current += char;
  }
  if (current) pages.push(current);
  return pages;
}
export function escapeTelegramMarkdown(text: string): string {
  return text.replace(/([_*[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
}
/** Escape after pagination: a MarkdownV2 escape must never be split over pages. */
export function telegramPages(text: string): string[] { return paginate(text, 2000).map(escapeTelegramMarkdown); }
export function plainMarkdown(text: string): string {
  return text.replace(/```[^\n]*\n([\s\S]*?)```/g, '$1').replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '$1 ($2)').replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)').replace(/^#{1,6}\s+/gm, '').replace(/\*\*([^*]+)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1');
}
