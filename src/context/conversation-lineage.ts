import type { DisplayMessage } from '../core/types/conversation.js';

function isActive(message: DisplayMessage): boolean {
  return message.stopped !== true && !message.discardedAt;
}

function chronologically(a: DisplayMessage, b: DisplayMessage): number {
  if (a.createdAt !== b.createdAt) {
    return a.createdAt < b.createdAt ? -1 : 1;
  }
  return a.id < b.id ? -1 : 1;
}

function latest(messages: DisplayMessage[]): DisplayMessage {
  return messages.reduce((newest, candidate) =>
    chronologically(candidate, newest) > 0 ? candidate : newest,
  );
}

function hasParentPointer(message: DisplayMessage): boolean {
  return message.parentMessageId != null;
}

export function resolveActiveLineage(messages: DisplayMessage[]): DisplayMessage[] {
  const live = messages.filter(isActive);
  if (live.length === 0) {
    return [];
  }

  const leaf = latest(live);

  if (!messages.some(hasParentPointer)) {
    const branch = leaf.branchId ?? null;
    return live.filter((m) => (m.branchId ?? null) === branch).sort(chronologically);
  }

  const byId = new Map(messages.map((m) => [m.id, m]));
  const chain: DisplayMessage[] = [];
  const seen = new Set<string>();
  let cursor: DisplayMessage | undefined = leaf;
  while (cursor && !seen.has(cursor.id)) {
    seen.add(cursor.id);
    if (isActive(cursor)) {
      chain.push(cursor);
    }
    cursor = hasParentPointer(cursor) ? byId.get(cursor.parentMessageId as string) : undefined;
  }

  return chain.sort(chronologically);
}
