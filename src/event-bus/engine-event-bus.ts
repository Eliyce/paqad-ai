import { randomUUID } from 'node:crypto';

import type {
  EngineEvent,
  EngineEventCallback,
  EngineEventFilter,
  EngineEventKind,
  Subscription,
  SubscriptionState,
} from './types.js';

/** Tuning knobs for an {@link EngineEventBus} instance. */
export interface EngineEventBusOptions {
  /**
   * Per-subscriber ring-buffer capacity. When a subscriber's buffer is full and
   * a new droppable event arrives, the oldest droppable event is discarded and
   * the subscriber receives an `events-coalesced` marker. Default 512.
   */
  bufferSize?: number;
  /**
   * Event kinds that must never be dropped when a buffer overflows. The
   * `events-coalesced` marker is always protected regardless of this set.
   * Default: decision events, which a UI must not miss.
   */
  neverDrop?: readonly EngineEventKind[];
  /**
   * Maximum serialised size (bytes) of an event payload before its string
   * fields are truncated and the event is tagged `truncated`. Default 65536.
   */
  maxPayloadBytes?: number;
}

const DEFAULT_BUFFER_SIZE = 512;
const DEFAULT_MAX_PAYLOAD_BYTES = 65536;
const DEFAULT_NEVER_DROP: readonly EngineEventKind[] = [
  'decision-paused',
  'decision-resolved',
  'decision-packet-corrupt',
  'decision-cap-exceeded',
  'decision-discarded',
];

interface SubscriberRecord {
  readonly id: string;
  readonly callback: EngineEventCallback;
  /** `null` means "all kinds". */
  readonly kinds: ReadonlySet<EngineEventKind> | null;
  readonly capacity: number;
  ring: EngineEvent[];
  /** Events dropped since the last delivered `events-coalesced` marker. */
  droppedSinceMarker: number;
  state: SubscriptionState;
  readonly handle: Subscription;
}

/**
 * In-process, unified engine event bus (PQD-99).
 *
 * Subscribers register a callback and an optional kind filter; the engine calls
 * {@link emit} which enqueues to each subscriber's ring buffer and schedules a
 * microtask drain — `emit` itself never invokes a callback and never blocks
 * engine work. A slow subscriber's overflow is absorbed by dropping its oldest
 * non-critical events and tagging the next delivery with an `events-coalesced`
 * marker. A throwing callback faults only its own subscription; all others keep
 * receiving events. Deliberately does not extend Node's `EventEmitter` so the
 * surface stays exactly `subscribe`/`emit`/`unsubscribe`.
 */
export class EngineEventBus {
  private readonly subscribers = new Map<string, SubscriberRecord>();
  private readonly bufferSize: number;
  private readonly neverDrop: ReadonlySet<EngineEventKind>;
  private readonly maxPayloadBytes: number;
  private drainScheduled = false;

  constructor(options: EngineEventBusOptions = {}) {
    this.bufferSize =
      options.bufferSize && options.bufferSize > 0 ? options.bufferSize : DEFAULT_BUFFER_SIZE;
    this.maxPayloadBytes =
      options.maxPayloadBytes && options.maxPayloadBytes > 0
        ? options.maxPayloadBytes
        : DEFAULT_MAX_PAYLOAD_BYTES;
    this.neverDrop = new Set([...(options.neverDrop ?? DEFAULT_NEVER_DROP), 'events-coalesced']);
  }

  /**
   * Register a subscriber. Without a filter, every kind is delivered. The
   * returned {@link Subscription} exposes live `state` and `unsubscribe()`.
   */
  subscribe(callback: EngineEventCallback, filter?: EngineEventFilter): Subscription {
    const id = randomUUID();
    const subscribers = this.subscribers;
    const handle: Subscription = {
      id,
      get state(): SubscriptionState {
        return subscribers.get(id)?.state ?? 'cancelled';
      },
      unsubscribe: () => this.unsubscribe(id),
    };
    const record: SubscriberRecord = {
      id,
      callback,
      kinds: filter ? new Set(filter.kinds) : null,
      capacity: this.bufferSize,
      ring: [],
      droppedSinceMarker: 0,
      state: 'active',
      handle,
    };
    this.subscribers.set(id, record);
    return handle;
  }

  /**
   * Emit an event to every matching active subscriber. Enqueues only and
   * schedules an async drain — never invokes a callback inline, never blocks.
   */
  emit(event: EngineEvent): void {
    const delivered = this.truncateIfOversized(event);
    for (const record of this.subscribers.values()) {
      if (record.state !== 'active') continue;
      if (record.kinds && !record.kinds.has(delivered.kind)) continue;
      this.enqueue(record, delivered);
    }
    this.scheduleDrain();
  }

  /** Stop delivery to a subscription and release its buffer. */
  unsubscribe(id: string): void {
    const record = this.subscribers.get(id);
    if (!record) return;
    record.state = 'cancelled';
    record.ring = [];
    record.droppedSinceMarker = 0;
    this.subscribers.delete(id);
  }

  /** Total registered subscriptions (active + faulted; excludes cancelled). */
  subscriberCount(): number {
    return this.subscribers.size;
  }

  /** Subscriptions currently in the `active` state. */
  activeSubscriberCount(): number {
    let count = 0;
    for (const record of this.subscribers.values()) {
      if (record.state === 'active') count += 1;
    }
    return count;
  }

  private enqueue(record: SubscriberRecord, event: EngineEvent): void {
    if (record.ring.length >= record.capacity) {
      const dropIndex = record.ring.findIndex((e) => !this.neverDrop.has(e.kind));
      if (dropIndex === -1) {
        // Buffer is full of protected events — drop the incoming one instead so
        // the engine never stalls and surviving order is preserved.
        record.droppedSinceMarker += 1;
        return;
      }
      record.ring.splice(dropIndex, 1);
      record.droppedSinceMarker += 1;
    }
    record.ring.push(event);
  }

  private scheduleDrain(): void {
    if (this.drainScheduled) return;
    this.drainScheduled = true;
    queueMicrotask(() => this.drain());
  }

  private drain(): void {
    this.drainScheduled = false;
    for (const record of [...this.subscribers.values()]) {
      this.deliver(record);
    }
  }

  private deliver(record: SubscriberRecord): void {
    while (record.state === 'active' && (record.ring.length > 0 || record.droppedSinceMarker > 0)) {
      let next: EngineEvent;
      if (record.droppedSinceMarker > 0) {
        next = {
          kind: 'events-coalesced',
          at: new Date().toISOString(),
          droppedCount: record.droppedSinceMarker,
        };
        record.droppedSinceMarker = 0;
      } else {
        next = record.ring.shift() as EngineEvent;
      }
      try {
        record.callback(next);
      } catch {
        record.state = 'faulted';
        record.ring = [];
        record.droppedSinceMarker = 0;
        return;
      }
    }
  }

  private truncateIfOversized(event: EngineEvent): EngineEvent {
    if (JSON.stringify(event).length <= this.maxPayloadBytes) {
      return event;
    }
    const clone: Record<string, unknown> = { ...event };
    for (const [key, value] of Object.entries(clone)) {
      if (key === 'kind' || key === 'at') continue;
      if (typeof value === 'string' && value.length > 64) {
        clone[key] = `${value.slice(0, 64)}…[truncated]`;
      }
    }
    clone.truncated = true;
    return clone as unknown as EngineEvent;
  }
}
