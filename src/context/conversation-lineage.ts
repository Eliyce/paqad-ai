import type { DisplayMessage } from '../core/types/conversation.js';

// PQD-171 Step 2 — pure, deterministic active-branch resolver.
//
// A display conversation may contain stopped turns, discarded edits, and
// competing branches. The API conversation must follow only the *active*
// lineage: the chain from the most-recent live message back to its root, with
// stopped/discarded turns removed. The result is always chronological so the
// same input yields byte-identical output regardless of array order.

/** A live turn: neither stopped mid-stream nor discarded by an edit. */
function isActive(message: DisplayMessage): boolean {
  return message.stopped !== true && !message.discardedAt;
}

/** Stable chronological order: by `createdAt`, then `id` to break ties. */
function chronologically(a: DisplayMessage, b: DisplayMessage): number {
  if (a.createdAt !== b.createdAt) {
    return a.createdAt < b.createdAt ? -1 : 1;
  }
  return a.id < b.id ? -1 : 1;
}

/** The most-recent message — the leaf of the active branch. */
function latest(messages: DisplayMessage[]): DisplayMessage {
  return messages.reduce((newest, candidate) =>
    chronologically(candidate, newest) > 0 ? candidate : newest,
  );
}

function hasParentPointer(message: DisplayMessage): boolean {
  return message.parentMessageId != null;
}

/**
 * Resolve the active-branch lineage of a display conversation.
 *
 * - Excludes every message with `stopped === true` or `discardedAt` set.
 * - When parent pointers exist, walks back from the most-recent live message to
 *   its root, so a competing branch (not an ancestor of the leaf) is dropped.
 * - When no parent pointers exist (a flat history), keeps every live message on
 *   the leaf's branch — the current desktop shape, where the whole list is one
 *   linear conversation.
 * - Always returns messages in chronological order; pure and deterministic.
 */
export function resolveActiveLineage(messages: DisplayMessage[]): DisplayMessage[] {
  const live = messages.filter(isActive);
  if (live.length === 0) {
    return [];
  }

  const leaf = latest(live);

  // Flat history: no lineage to walk, so keep the leaf's branch as-is.
  if (!messages.some(hasParentPointer)) {
    const branch = leaf.branchId ?? null;
    return live.filter((m) => (m.branchId ?? null) === branch).sort(chronologically);
  }

  // Tree: follow parent pointers from the leaf to the root, collecting live
  // turns and skipping over any stopped/discarded ancestor on the way.
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
