import { describe, expect, it, vi } from 'vitest';

import { SliceEventBus } from '@/planning/slice-event-bus.js';
import type { SliceExecutionEvent } from '@/core/types/planning.js';

function collector() {
  const events: SliceExecutionEvent[] = [];
  return { events, onEvent: (event: SliceExecutionEvent) => events.push(event) };
}

describe('SliceEventBus', () => {
  it('stamps runId, slug, monotonic seq, and an ISO timestamp and delivers synchronously', () => {
    const { events, onEvent } = collector();
    const bus = new SliceEventBus({ runId: 'run-1', slug: 'demo', onEvent });

    bus.emit({ kind: 'slice-started', sliceId: 'SL-1', attempt: 1, tokenBudget: 1000 });
    bus.emit({ kind: 'slice-gate-evaluated', sliceId: 'SL-1', status: 'pass', reasons: [] });

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      kind: 'slice-started',
      runId: 'run-1',
      slug: 'demo',
      seq: 1,
      sliceId: 'SL-1',
    });
    expect(events[1]!.seq).toBe(2);
    expect(events[0]!.ts).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/u);
    expect(new Date(events[0]!.ts).toISOString()).toBe(events[0]!.ts);
  });

  it('is a no-op (never throws) when no onEvent callback is supplied', () => {
    const bus = new SliceEventBus({ runId: 'run-1', slug: 'demo' });
    expect(() =>
      bus.emit({ kind: 'slice-started', sliceId: 'SL-1', attempt: 1, tokenBudget: 1 }),
    ).not.toThrow();
  });

  it('preserves variant-specific payloads such as gate-failure reasons', () => {
    const { events, onEvent } = collector();
    const bus = new SliceEventBus({ runId: 'run-1', slug: 'demo', onEvent });

    bus.emit({
      kind: 'slice-gate-evaluated',
      sliceId: 'SL-1',
      status: 'fail',
      reasons: ['Verification criterion AC-1 not met: still red'],
    });

    expect(events[0]).toMatchObject({
      status: 'fail',
      reasons: ['Verification criterion AC-1 not met: still red'],
    });
  });

  it('buffers while paused and flushes in order on resume', () => {
    const { events, onEvent } = collector();
    const bus = new SliceEventBus({ runId: 'run-1', slug: 'demo', onEvent });

    bus.pause();
    bus.emit({ kind: 'slice-started', sliceId: 'SL-1', attempt: 1, tokenBudget: 1 });
    bus.emit({ kind: 'slice-gate-evaluated', sliceId: 'SL-1', status: 'pass', reasons: [] });
    expect(events).toHaveLength(0);

    bus.resume();
    expect(events.map((event) => event.kind)).toEqual(['slice-started', 'slice-gate-evaluated']);
  });

  it('coalesces the oldest droppable events under backpressure but never drops a terminal event', () => {
    const { events, onEvent } = collector();
    const bus = new SliceEventBus({ runId: 'run-1', slug: 'demo', onEvent, bufferLimit: 2 });

    bus.pause();
    for (let i = 0; i < 1000; i += 1) {
      bus.emit({ kind: 'slice-gate-evaluated', sliceId: 'SL-1', status: 'pass', reasons: [] });
    }
    bus.emit({
      kind: 'run-finished',
      trackerStatus: 'completed',
      completedSliceIds: ['SL-1'],
      blockedSliceIds: [],
      escalatedSliceIds: [],
    });
    bus.resume();

    expect(events.some((event) => event.coalesced === true)).toBe(true);
    expect(events.some((event) => event.kind === 'run-finished')).toBe(true);
    // The buffer never grew unbounded: droppable events were collapsed.
    expect(events.length).toBeLessThan(1001);
  });

  it('pushes a droppable event without a coalesced marker when the buffer holds only protected events', () => {
    const { events, onEvent } = collector();
    const bus = new SliceEventBus({
      runId: 'run-1',
      slug: 'demo',
      onEvent,
      bufferLimit: 1,
      neverDrop: ['slice-started'],
    });

    bus.pause();
    bus.emit({ kind: 'slice-started', sliceId: 'SL-1', attempt: 1, tokenBudget: 1 });
    bus.emit({ kind: 'slice-gate-evaluated', sliceId: 'SL-1', status: 'pass', reasons: [] });
    bus.resume();

    expect(events.map((event) => event.kind)).toEqual(['slice-started', 'slice-gate-evaluated']);
    expect(events.every((event) => event.coalesced === undefined)).toBe(true);
  });

  it('emits exactly one slice-cancelled event and ignores all subsequent emits', () => {
    const { events, onEvent } = collector();
    const bus = new SliceEventBus({ runId: 'run-1', slug: 'demo', onEvent });

    bus.emit({ kind: 'slice-started', sliceId: 'SL-1', attempt: 1, tokenBudget: 1 });
    bus.cancel();
    bus.cancel();
    bus.emit({ kind: 'slice-gate-evaluated', sliceId: 'SL-1', status: 'pass', reasons: [] });

    const cancelled = events.filter((event) => event.kind === 'slice-cancelled');
    expect(cancelled).toHaveLength(1);
    expect(events.at(-1)!.kind).toBe('slice-cancelled');
    expect(cancelled[0]).toMatchObject({ stoppedAtSeq: cancelled[0]!.seq });
  });

  it('flushes buffered events before delivering the cancellation event', () => {
    const { events, onEvent } = collector();
    const bus = new SliceEventBus({ runId: 'run-1', slug: 'demo', onEvent });

    bus.pause();
    bus.emit({ kind: 'slice-started', sliceId: 'SL-1', attempt: 1, tokenBudget: 1 });
    bus.cancel();

    expect(events.map((event) => event.kind)).toEqual(['slice-started', 'slice-cancelled']);
  });

  it('truncates oversized string and string-array payloads and tags the event', () => {
    const { events, onEvent } = collector();
    const bus = new SliceEventBus({ runId: 'run-1', slug: 'demo', onEvent, maxPayloadBytes: 50 });

    bus.emit({
      kind: 'slice-escalated',
      sliceId: 'SL-1',
      reason: 'x'.repeat(200),
      blockedDownstream: ['y'.repeat(200), 'short'],
    });

    const event = events[0] as Extract<SliceExecutionEvent, { kind: 'slice-escalated' }>;
    expect(event.truncated).toBe(true);
    expect(event.reason).toContain('…[truncated]');
    expect(event.reason.length).toBeLessThan(200);
    expect(event.blockedDownstream[0]).toContain('…[truncated]');
    expect(event.blockedDownstream[1]).toBe('short');
    expect(event.sliceId).toBe('SL-1');
  });

  it('does not truncate events within the payload budget', () => {
    const { events, onEvent } = collector();
    const bus = new SliceEventBus({ runId: 'run-1', slug: 'demo', onEvent });

    bus.emit({ kind: 'slice-started', sliceId: 'SL-1', attempt: 1, tokenBudget: 1 });
    expect(events[0]!.truncated).toBeUndefined();
  });

  it('swallows a throwing consumer callback so the engine never crashes', () => {
    const onEvent = vi.fn<(event: SliceExecutionEvent) => void>(() => {
      throw new Error('consumer blew up');
    });
    const bus = new SliceEventBus({ runId: 'run-1', slug: 'demo', onEvent });

    expect(() =>
      bus.emit({ kind: 'slice-started', sliceId: 'SL-1', attempt: 1, tokenBudget: 1 }),
    ).not.toThrow();
    expect(() =>
      bus.emit({ kind: 'slice-gate-evaluated', sliceId: 'SL-1', status: 'pass', reasons: [] }),
    ).not.toThrow();
    expect(onEvent).toHaveBeenCalledTimes(2);
  });

  it('falls back to default tuning when given non-positive option values', () => {
    const { events, onEvent } = collector();
    const bus = new SliceEventBus({
      runId: 'run-1',
      slug: 'demo',
      onEvent,
      maxPayloadBytes: 0,
      bufferLimit: -5,
    });

    // With defaults restored, a small event is delivered untouched.
    bus.emit({ kind: 'slice-started', sliceId: 'SL-1', attempt: 1, tokenBudget: 1 });
    expect(events[0]!.truncated).toBeUndefined();
  });
});
