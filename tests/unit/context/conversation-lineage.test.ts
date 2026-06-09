import { describe, expect, it } from 'vitest';

import { resolveActiveLineage } from '@/context/conversation-lineage.js';
import type { DisplayMessage } from '@/core/types/conversation.js';

function msg(id: string, createdAt: string, extra: Partial<DisplayMessage> = {}): DisplayMessage {
  return { id, role: 'user', content: `c-${id}`, createdAt, ...extra };
}

const ids = (messages: DisplayMessage[]): string[] => messages.map((m) => m.id);

describe('resolveActiveLineage', () => {
  it('returns [] for an empty conversation', () => {
    expect(resolveActiveLineage([])).toEqual([]);
  });

  it('returns [] when every message is stopped or discarded', () => {
    const messages = [
      msg('a', '2026-01-01T00:00:00Z', { stopped: true }),
      msg('b', '2026-01-01T00:01:00Z', { discardedAt: '2026-01-01T00:02:00Z' }),
    ];
    expect(resolveActiveLineage(messages)).toEqual([]);
  });

  it('flat history: excludes stopped and discarded turns, keeps chronological order', () => {
    const messages = [
      msg('a', '2026-01-01T00:00:00Z'),
      msg('b', '2026-01-01T00:01:00Z', { stopped: true }),
      msg('c', '2026-01-01T00:02:00Z', { discardedAt: '2026-01-01T00:03:00Z' }),
      msg('d', '2026-01-01T00:04:00Z'),
    ];
    expect(ids(resolveActiveLineage(messages))).toEqual(['a', 'd']);
  });

  it('flat history: follows only the active branch of the most-recent message', () => {
    const messages = [
      msg('a', '2026-01-01T00:00:00Z'), // main branch (branchId undefined → null)
      msg('b', '2026-01-01T00:01:00Z', { branchId: 'alt' }),
      msg('c', '2026-01-01T00:02:00Z', { branchId: 'alt' }),
    ];
    // Leaf is c on branch "alt"; the main-branch message a is excluded.
    expect(ids(resolveActiveLineage(messages))).toEqual(['b', 'c']);
  });

  it('flat history: discardedAt null is treated as live', () => {
    const messages = [msg('a', '2026-01-01T00:00:00Z', { discardedAt: null, stopped: false })];
    expect(ids(resolveActiveLineage(messages))).toEqual(['a']);
  });

  it('is order-independent: shuffled input yields the same lineage', () => {
    const messages = [
      msg('a', '2026-01-01T00:00:00Z'),
      msg('b', '2026-01-01T00:01:00Z'),
      msg('c', '2026-01-01T00:02:00Z'),
    ];
    const forward = resolveActiveLineage(messages);
    const shuffled = resolveActiveLineage([messages[2], messages[0], messages[1]]);
    expect(ids(forward)).toEqual(['a', 'b', 'c']);
    expect(ids(shuffled)).toEqual(ids(forward));
  });

  it('breaks createdAt ties deterministically by id', () => {
    const messages = [
      msg('b', '2026-01-01T00:00:00Z'),
      msg('a', '2026-01-01T00:00:00Z'),
      msg('c', '2026-01-01T00:00:00Z'),
    ];
    expect(ids(resolveActiveLineage(messages))).toEqual(['a', 'b', 'c']);
  });

  it('tree: walks the parent chain and drops a competing branch', () => {
    const messages = [
      msg('a', '2026-01-01T00:00:00Z', { parentMessageId: null }),
      msg('b', '2026-01-01T00:01:00Z', { parentMessageId: 'a' }),
      msg('alt', '2026-01-01T00:01:30Z', { parentMessageId: 'a', branchId: 'alt' }),
      msg('c', '2026-01-01T00:02:00Z', { parentMessageId: 'b' }),
    ];
    // Leaf c → b → a; the competing "alt" branch is not on that chain.
    expect(ids(resolveActiveLineage(messages))).toEqual(['a', 'b', 'c']);
  });

  it('tree: skips a stopped ancestor but keeps its parent', () => {
    const messages = [
      msg('a', '2026-01-01T00:00:00Z', { parentMessageId: null }),
      msg('b', '2026-01-01T00:01:00Z', { parentMessageId: 'a', stopped: true }),
      msg('c', '2026-01-01T00:02:00Z', { parentMessageId: 'b' }),
    ];
    expect(ids(resolveActiveLineage(messages))).toEqual(['a', 'c']);
  });

  it('tree: terminates on a parent-pointer cycle', () => {
    const messages = [
      msg('a', '2026-01-01T00:00:00Z', { parentMessageId: 'b' }),
      msg('b', '2026-01-01T00:01:00Z', { parentMessageId: 'a' }),
    ];
    expect(ids(resolveActiveLineage(messages))).toEqual(['a', 'b']);
  });
});
