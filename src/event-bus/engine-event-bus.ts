import { randomUUID } from 'node:crypto';

import type {
  EngineEvent,
  EngineEventCallback,
  EngineEventFilter,
  EngineEventKind,
  Subscription,
  SubscriptionState,
} from './types.js';

export interface EngineEventBusOptions {
  bufferSize?: number;
  neverDrop?: readonly EngineEventKind[];
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
  readonly kinds: ReadonlySet<EngineEventKind> | null;
  readonly capacity: number;
  ring: EngineEvent[];
  droppedSinceMarker: number;
  state: SubscriptionState;
  readonly handle: Subscription;
}

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

  emit(event: EngineEvent): void {
    const delivered = this.truncateIfOversized(event);
    for (const record of this.subscribers.values()) {
      if (record.state !== 'active') continue;
      if (record.kinds && !record.kinds.has(delivered.kind)) continue;
      this.enqueue(record, delivered);
    }
    this.scheduleDrain();
  }

  unsubscribe(id: string): void {
    const record = this.subscribers.get(id);
    if (!record) return;
    record.state = 'cancelled';
    record.ring = [];
    record.droppedSinceMarker = 0;
    this.subscribers.delete(id);
  }

  subscriberCount(): number {
    return this.subscribers.size;
  }

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
