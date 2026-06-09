import { describe, expect, it } from 'vitest';

import { EngineEventBus } from '@/event-bus/engine-event-bus.js';
import type { EngineEvent } from '@/event-bus/types.js';

/** Flush the queueMicrotask-scheduled drain (and any re-scheduled drains). */
async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function sliceStarted(sliceId: string, at = '2026-01-01T00:00:00.000Z'): EngineEvent {
  return { kind: 'slice-started', at, runId: 'run-1', sliceId };
}

describe('EngineEventBus', () => {
  it('delivers every kind to an unfiltered subscriber in emit order', async () => {
    const bus = new EngineEventBus();
    const received: EngineEvent[] = [];
    bus.subscribe((e) => received.push(e));

    bus.emit(sliceStarted('a'));
    bus.emit({
      kind: 'registry-changed',
      at: '2026-01-01T00:00:01.000Z',
      registry: 'skills',
      change: 'added',
    });
    bus.emit({ kind: 'retrieval-started', at: '2026-01-01T00:00:02.000Z', queryId: 'q1' });

    // emit is non-blocking: nothing delivered synchronously.
    expect(received).toHaveLength(0);

    await flush();
    expect(received.map((e) => e.kind)).toEqual([
      'slice-started',
      'registry-changed',
      'retrieval-started',
    ]);
  });

  it('delivers only matching kinds to a filtered subscriber without affecting others', async () => {
    const bus = new EngineEventBus();
    const filtered: EngineEvent[] = [];
    const all: EngineEvent[] = [];
    bus.subscribe((e) => filtered.push(e), { kinds: ['workflow-step-started'] });
    bus.subscribe((e) => all.push(e));

    bus.emit({
      kind: 'workflow-step-started',
      at: '2026-01-01T00:00:00.000Z',
      runId: 'r',
      stepIndex: 0,
      skill: 'scope-check',
    });
    bus.emit(sliceStarted('a'));
    await flush();

    expect(filtered.map((e) => e.kind)).toEqual(['workflow-step-started']);
    expect(all.map((e) => e.kind)).toEqual(['workflow-step-started', 'slice-started']);
  });

  it('keeps parallel subscribers independent', async () => {
    const bus = new EngineEventBus();
    const a: EngineEvent[] = [];
    const b: EngineEvent[] = [];
    const subA = bus.subscribe((e) => a.push(e));
    bus.subscribe((e) => b.push(e));

    bus.emit(sliceStarted('1'));
    await flush();
    subA.unsubscribe();
    bus.emit(sliceStarted('2'));
    await flush();

    expect(a.map((e) => (e as { sliceId: string }).sliceId)).toEqual(['1']);
    expect(b.map((e) => (e as { sliceId: string }).sliceId)).toEqual(['1', '2']);
  });

  it('coalesces overflow and tags the next delivery with an events-coalesced marker', async () => {
    const bus = new EngineEventBus({ bufferSize: 2, neverDrop: [] });
    const received: EngineEvent[] = [];
    bus.subscribe((e) => received.push(e));

    for (let i = 1; i <= 5; i++) {
      bus.emit(sliceStarted(String(i)));
    }
    // emit() never blocked or delivered inline despite the overflow.
    expect(received).toHaveLength(0);
    await flush();

    expect(received[0].kind).toBe('events-coalesced');
    expect((received[0] as { droppedCount: number }).droppedCount).toBe(3);
    expect(received.slice(1).map((e) => (e as { sliceId: string }).sliceId)).toEqual(['4', '5']);
  });

  it('never drops a protected kind: drops the incoming protected event instead', async () => {
    const bus = new EngineEventBus({ bufferSize: 1 }); // default neverDrop includes decision-paused
    const received: EngineEvent[] = [];
    bus.subscribe((e) => received.push(e));

    bus.emit({ kind: 'decision-paused', at: '2026-01-01T00:00:00.000Z', decisionId: 'd1' });
    bus.emit({ kind: 'decision-paused', at: '2026-01-01T00:00:01.000Z', decisionId: 'd2' });
    await flush();

    expect(received[0].kind).toBe('events-coalesced');
    expect(received[1].kind).toBe('decision-paused');
    expect((received[1] as { decisionId: string }).decisionId).toBe('d1');
  });

  it('preserves a protected event while dropping older droppable ones', async () => {
    const bus = new EngineEventBus({ bufferSize: 2 });
    const received: EngineEvent[] = [];
    bus.subscribe((e) => received.push(e));

    bus.emit({ kind: 'decision-paused', at: '2026-01-01T00:00:00.000Z', decisionId: 'keep' });
    bus.emit(sliceStarted('s1'));
    bus.emit(sliceStarted('s2'));
    bus.emit(sliceStarted('s3'));
    await flush();

    const kinds = received.map((e) => e.kind);
    expect(kinds[0]).toBe('events-coalesced');
    expect(kinds).toContain('decision-paused');
    expect((received[1] as { decisionId?: string }).decisionId).toBe('keep');
  });

  it('stops delivery and reports cancelled state after unsubscribe', async () => {
    const bus = new EngineEventBus();
    const received: EngineEvent[] = [];
    const sub = bus.subscribe((e) => received.push(e));
    expect(sub.state).toBe('active');

    sub.unsubscribe();
    expect(sub.state).toBe('cancelled');
    bus.emit(sliceStarted('a'));
    await flush();

    expect(received).toHaveLength(0);
    expect(bus.subscriberCount()).toBe(0);
  });

  it('isolates a faulted callback and keeps delivering to others', async () => {
    const bus = new EngineEventBus();
    const good: EngineEvent[] = [];
    const bad = bus.subscribe(() => {
      throw new Error('boom');
    });
    bus.subscribe((e) => good.push(e));

    bus.emit(sliceStarted('a'));
    await flush();

    expect(bad.state).toBe('faulted');
    expect(good.map((e) => e.kind)).toEqual(['slice-started']);

    // A faulted subscription receives nothing further; others still do.
    bus.emit(sliceStarted('b'));
    await flush();
    expect(good).toHaveLength(2);
    expect(bus.activeSubscriberCount()).toBe(1);
    expect(bus.subscriberCount()).toBe(2);
  });

  it('preserves stable relative order for identical timestamps', async () => {
    const bus = new EngineEventBus();
    const received: EngineEvent[] = [];
    bus.subscribe((e) => received.push(e));

    const ts = '2026-01-01T12:00:00.000Z';
    bus.emit(sliceStarted('first', ts));
    bus.emit(sliceStarted('second', ts));
    await flush();

    expect(received.map((e) => (e as { sliceId: string }).sliceId)).toEqual(['first', 'second']);
  });

  it('truncates an oversized string payload and tags it truncated', async () => {
    const bus = new EngineEventBus({ maxPayloadBytes: 10 });
    const received: EngineEvent[] = [];
    bus.subscribe((e) => received.push(e));

    bus.emit({
      kind: 'retrieval-started',
      at: '2026-01-01T00:00:00.000Z',
      queryId: 'q',
      query: 'x'.repeat(200),
    });
    await flush();

    const event = received[0] as { truncated?: boolean; query: string };
    expect(event.truncated).toBe(true);
    expect(event.query.endsWith('…[truncated]')).toBe(true);
    expect(event.query.length).toBeLessThan(200);
  });

  it('marks an oversized event truncated even when no string field exceeds the field cap', async () => {
    const bus = new EngineEventBus({ maxPayloadBytes: 5 });
    const received: EngineEvent[] = [];
    bus.subscribe((e) => received.push(e));

    bus.emit({
      kind: 'retrieval-started',
      at: '2026-01-01T00:00:00.000Z',
      queryId: 'q',
      query: 'short',
    });
    await flush();

    const event = received[0] as { truncated?: boolean; query: string };
    expect(event.truncated).toBe(true);
    expect(event.query).toBe('short');
  });

  it('falls back to defaults for non-positive option values', async () => {
    const bus = new EngineEventBus({ bufferSize: 0, maxPayloadBytes: 0 });
    const received: EngineEvent[] = [];
    bus.subscribe((e) => received.push(e));

    bus.emit(sliceStarted('a'));
    await flush();
    expect(received).toHaveLength(1);
    expect(received[0].truncated).toBeUndefined();
  });

  it('treats emit with no subscribers and unsubscribe of an unknown id as no-ops', async () => {
    const bus = new EngineEventBus();
    expect(() => bus.emit(sliceStarted('a'))).not.toThrow();
    expect(() => bus.unsubscribe('does-not-exist')).not.toThrow();
    await flush();
    expect(bus.subscriberCount()).toBe(0);
    expect(bus.activeSubscriberCount()).toBe(0);
  });
});
