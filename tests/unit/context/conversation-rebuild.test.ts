import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ContextBudgetOptimizer } from '@/context/budget-optimizer.js';
import { ContextEvictor } from '@/context/context-evictor.js';
import { rebuildApiConversation } from '@/context/conversation-rebuild.js';
import { PriorityClassifier } from '@/context/priority-classifier.js';
import { RebuildCache } from '@/context/rebuild-cache.js';
import { TurnSummarizer } from '@/context/turn-summarizer.js';
import { RebuildFailedError } from '@/core/types/conversation.js';
import type { DisplayMessage } from '@/core/types/conversation.js';
import { readModuleMapEvents } from '@/module-decisions/events.js';

function dmsg(
  id: string,
  createdAt: string,
  content: string,
  extra: Partial<DisplayMessage> = {},
): DisplayMessage {
  return { id, role: 'user', content, createdAt, ...extra };
}

/** A real optimizer; its `summarizeTurns` is pure (no disk I/O). */
function makeOptimizer(root: string): ContextBudgetOptimizer {
  return new ContextBudgetOptimizer(
    new TurnSummarizer(),
    new PriorityClassifier(),
    new ContextEvictor(),
    root,
  );
}

describe('rebuildApiConversation', () => {
  it('AC5: throws RebuildFailedError on a non-positive budget and does not retry', async () => {
    const messages = [dmsg('a', '2026-01-01T00:00:00Z', 'hello')];
    await expect(
      rebuildApiConversation({ displayMessages: messages, classifierOutput: {}, budgetTokens: 0 }),
    ).rejects.toBeInstanceOf(RebuildFailedError);

    const failure = await rebuildApiConversation({
      displayMessages: messages,
      classifierOutput: {},
      budgetTokens: 0,
    }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(RebuildFailedError);
    expect((failure as RebuildFailedError).kind).toBe('rebuild_failed');
    expect((failure as RebuildFailedError).reason).toContain('budgetTokens');
  });

  it('AC5: rejects a non-finite budget breakdown', async () => {
    await expect(
      rebuildApiConversation({
        displayMessages: [dmsg('a', '2026-01-01T00:00:00Z', 'hi')],
        classifierOutput: {},
        budgetTokens: Number.NaN,
      }),
    ).rejects.toBeInstanceOf(RebuildFailedError);
  });

  it('AC2: identical input (no cache) yields byte-equal results', async () => {
    const messages = [
      dmsg('a', '2026-01-01T00:00:00Z', 'first'),
      dmsg('b', '2026-01-01T00:01:00Z', 'second', { role: 'assistant' }),
    ];
    const input = { displayMessages: messages, classifierOutput: {}, budgetTokens: 1000 };
    const first = await rebuildApiConversation(input);
    const second = await rebuildApiConversation(input);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it('maps the active lineage to role/content-only API messages', async () => {
    const messages = [
      dmsg('a', '2026-01-01T00:00:00Z', 'hi'),
      dmsg('b', '2026-01-01T00:01:00Z', 'there', { role: 'assistant' }),
    ];
    const result = await rebuildApiConversation({
      displayMessages: messages,
      classifierOutput: { retrieval_needed: false },
      budgetTokens: 1000,
      summarizer: new TurnSummarizer(),
    });
    expect(result.messages).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'there' },
    ]);
    expect(result.truncated).toBe(false);
    expect(result.retrievedChunkIds).toEqual([]);
  });

  it('AC4: inserts retrieved chunks as a system message and returns their ids', async () => {
    const result = await rebuildApiConversation({
      displayMessages: [dmsg('a', '2026-01-01T00:00:00Z', 'question')],
      classifierOutput: { retrieval_needed: true },
      retrievedChunks: [
        { chunkId: 'c1', content: 'chunk one' },
        { chunkId: 'c2', content: 'chunk two' },
        { chunkId: 'c3', content: 'chunk three' },
      ],
      budgetTokens: 10000,
      summarizer: new TurnSummarizer(),
    });
    expect(result.retrievedChunkIds).toEqual(['c1', 'c2', 'c3']);
    const system = result.messages.find((m) => m.role === 'system');
    expect(system?.content).toContain('chunk one');
    expect(system?.content).toContain('chunk two');
    expect(system?.content).toContain('chunk three');
    // No leading system context ⇒ retrieval lands at the front.
    expect(result.messages[0]?.role).toBe('system');
  });

  it('inserts retrieval after leading system context', async () => {
    const result = await rebuildApiConversation({
      displayMessages: [
        dmsg('s', '2026-01-01T00:00:00Z', 'system context', { role: 'system' }),
        dmsg('a', '2026-01-01T00:01:00Z', 'question'),
      ],
      classifierOutput: { retrieval_needed: true },
      retrievedChunks: [{ chunkId: 'c1', content: 'chunk one' }],
      budgetTokens: 10000,
      summarizer: new TurnSummarizer(),
    });
    expect(result.messages[0]?.content).toBe('system context');
    expect(result.messages[1]?.content).toContain('chunk one');
    expect(result.messages[2]?.content).toBe('question');
  });

  it('retrieval_needed with no chunks inserts nothing', async () => {
    const result = await rebuildApiConversation({
      displayMessages: [dmsg('a', '2026-01-01T00:00:00Z', 'question')],
      classifierOutput: { retrieval_needed: true },
      budgetTokens: 10000,
      summarizer: new TurnSummarizer(),
    });
    expect(result.retrievedChunkIds).toEqual([]);
    expect(result.messages).toEqual([{ role: 'user', content: 'question' }]);
  });

  it('inserts retrieval into an empty history', async () => {
    const result = await rebuildApiConversation({
      displayMessages: [],
      classifierOutput: { retrieval_needed: true },
      retrievedChunks: [
        { chunkId: 'c1', content: 'one' },
        { chunkId: 'c2', content: 'two' },
      ],
      budgetTokens: 10000,
      summarizer: new TurnSummarizer(),
    });
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]?.role).toBe('system');
    expect(result.retrievedChunkIds).toEqual(['c1', 'c2']);
  });

  describe('budget pressure', () => {
    let root: string;

    beforeEach(() => {
      root = mkdtempSync(join(tmpdir(), 'paqad-rebuild-'));
    });

    afterEach(() => {
      rmSync(root, { recursive: true, force: true });
    });

    it('AC3: truncates the oldest turns and writes a context.truncated audit event', async () => {
      const messages = [
        dmsg('a', '2026-01-01T00:00:00Z', 'x'.repeat(200)),
        dmsg('b', '2026-01-01T00:01:00Z', 'y'.repeat(200)),
        dmsg('c', '2026-01-01T00:02:00Z', 'z'.repeat(200)),
      ];
      const result = await rebuildApiConversation({
        displayMessages: messages,
        classifierOutput: {},
        budgetTokens: 60, // each turn is 50 tokens; only the newest fits
        summarizer: new TurnSummarizer(),
        audit: { projectRoot: root, sessionId: 'sess-1' },
      });
      expect(result.truncated).toBe(true);
      expect(result.truncatedTurnCount).toBe(2);
      expect(result.messages).toHaveLength(1);
      expect(result.messages[0]?.content).toBe('z'.repeat(200));

      const events = readModuleMapEvents(root);
      const truncation = events.find((e) => e.type === 'context.truncated');
      expect(truncation?.payload).toMatchObject({
        sessionId: 'sess-1',
        turnsDropped: 2,
        tokensReclaimed: 100,
      });
    });

    it('reports truncation without an audit sink (no event written)', async () => {
      const result = await rebuildApiConversation({
        displayMessages: [
          dmsg('a', '2026-01-01T00:00:00Z', 'x'.repeat(200)),
          dmsg('b', '2026-01-01T00:01:00Z', 'y'.repeat(200)),
        ],
        classifierOutput: {},
        budgetTokens: 60,
        summarizer: new TurnSummarizer(),
      });
      expect(result.truncated).toBe(true);
      expect(result.truncatedTurnCount).toBe(1);
    });

    it('keeps the newest turn even when it alone exceeds the budget', async () => {
      const result = await rebuildApiConversation({
        displayMessages: [
          dmsg('a', '2026-01-01T00:00:00Z', 'x'.repeat(200)),
          dmsg('b', '2026-01-01T00:01:00Z', 'y'.repeat(200)),
        ],
        classifierOutput: {},
        budgetTokens: 10,
        summarizer: new TurnSummarizer(),
      });
      expect(result.truncatedTurnCount).toBe(1);
      expect(result.messages).toHaveLength(1);
      expect(result.messages[0]?.content).toBe('y'.repeat(200));
    });

    it('summarises older turns before truncating when an optimizer is supplied', async () => {
      const salient =
        'decided to use postgres for storage\ntouched lib/cache/store.ts now\n' +
        'error: connection refused here\nTODO: add retry logic\n';
      const filler = 'alpha beta gamma delta '.repeat(14);
      const messages = [
        dmsg('a', '2026-01-01T00:00:00Z', salient + filler),
        dmsg('b', '2026-01-01T00:01:00Z', filler),
        dmsg('c', '2026-01-01T00:02:00Z', 'ok thanks', { role: 'assistant' }),
        dmsg('d', '2026-01-01T00:03:00Z', 'sounds good'),
      ];
      const result = await rebuildApiConversation({
        displayMessages: messages,
        classifierOutput: {},
        budgetTokens: 160,
        summarizer: new TurnSummarizer(),
        optimizer: makeOptimizer(root),
      });
      expect(result.truncated).toBe(false);
      const summary = result.messages[0];
      expect(summary?.role).toBe('system');
      expect(summary?.content).toContain('Summary of 2 earlier turns');
      expect(summary?.content).toContain('decisions: use postgres for storage');
      expect(summary?.content).toContain('files: lib/cache/store.ts');
      expect(summary?.content).toContain('blockers:');
      expect(summary?.content).toContain('next:');
      expect(summary?.content).toContain('(no salient content)');
      expect(result.messages.at(-1)?.content).toBe('sounds good');
    });

    it('skips summarisation when only the recent turns remain', async () => {
      const optimizer = makeOptimizer(root);
      const spy = vi.spyOn(optimizer, 'summarizeTurns');
      const result = await rebuildApiConversation({
        displayMessages: [
          dmsg('a', '2026-01-01T00:00:00Z', 'x'.repeat(200)),
          dmsg('b', '2026-01-01T00:01:00Z', 'y'.repeat(200)),
        ],
        classifierOutput: {},
        budgetTokens: 60,
        summarizer: new TurnSummarizer(),
        optimizer,
      });
      expect(spy).not.toHaveBeenCalled();
      expect(result.truncated).toBe(true);
    });

    it('wraps an optimizer failure in RebuildFailedError', async () => {
      const throwing = {
        summarizeTurns: () => Promise.reject(new Error('boom')),
      } as unknown as ContextBudgetOptimizer;
      const messages = [
        dmsg('a', '2026-01-01T00:00:00Z', 'x'.repeat(200)),
        dmsg('b', '2026-01-01T00:01:00Z', 'y'.repeat(200)),
        dmsg('c', '2026-01-01T00:02:00Z', 'z'.repeat(200)),
      ];
      const failure = await rebuildApiConversation({
        displayMessages: messages,
        classifierOutput: {},
        budgetTokens: 60,
        summarizer: new TurnSummarizer(),
        optimizer: throwing,
      }).catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(RebuildFailedError);
      expect((failure as RebuildFailedError).reason).toContain('summarisation failed');
      expect((failure as RebuildFailedError).reason).toContain('boom');
    });

    it('wraps a non-Error optimizer rejection too', async () => {
      const rejection: unknown = 'plain string failure';
      const throwing = {
        summarizeTurns: () => Promise.reject(rejection),
      } as unknown as ContextBudgetOptimizer;
      const messages = [
        dmsg('a', '2026-01-01T00:00:00Z', 'x'.repeat(200)),
        dmsg('b', '2026-01-01T00:01:00Z', 'y'.repeat(200)),
        dmsg('c', '2026-01-01T00:02:00Z', 'z'.repeat(200)),
      ];
      const failure = await rebuildApiConversation({
        displayMessages: messages,
        classifierOutput: {},
        budgetTokens: 60,
        summarizer: new TurnSummarizer(),
        optimizer: throwing,
      }).catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(RebuildFailedError);
      expect((failure as RebuildFailedError).reason).toContain('plain string failure');
    });
  });

  describe('cache', () => {
    it('AC6: a hit skips the budget pass entirely', async () => {
      const summarizer = new TurnSummarizer();
      const estimateSpy = vi.spyOn(summarizer, 'estimateTokens');
      const cache = new RebuildCache();
      const input = {
        displayMessages: [dmsg('a', '2026-01-01T00:00:00Z', 'hello')],
        classifierOutput: { retrieval_needed: false },
        budgetTokens: 1000,
        summarizer,
        cache,
      };

      const first = await rebuildApiConversation(input);
      expect(estimateSpy).toHaveBeenCalled();

      estimateSpy.mockClear();
      const second = await rebuildApiConversation(input);
      expect(estimateSpy).not.toHaveBeenCalled();
      expect(second).toBe(first); // same cached object reference
    });

    it('recomputes for a different conversation (distinct cache key)', async () => {
      const cache = new RebuildCache();
      const base = {
        classifierOutput: {},
        budgetTokens: 1000,
        summarizer: new TurnSummarizer(),
        cache,
      };
      const a = await rebuildApiConversation({
        ...base,
        displayMessages: [dmsg('a', '2026-01-01T00:00:00Z', 'one')],
      });
      const b = await rebuildApiConversation({
        ...base,
        displayMessages: [dmsg('a', '2026-01-01T00:00:00Z', 'two')],
      });
      expect(a).not.toBe(b);
      expect(b.messages[0]?.content).toBe('two');
    });
  });
});
