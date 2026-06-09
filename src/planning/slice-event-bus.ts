import type {
  SliceExecutionCancelledEvent,
  SliceExecutionEvent,
  SliceExecutionEventKind,
} from '@/core/types/planning.js';

/**
 * The fields a caller supplies to {@link SliceEventBus.emit}: a slice execution
 * event minus the fields the bus stamps itself (`runId`, `slug`, `seq`, `ts`)
 * and the markers it manages (`coalesced`, `truncated`). Distributes over the
 * union so each variant keeps its own discriminated payload.
 */
export type SliceEventDraft = SliceExecutionEvent extends infer Variant
  ? Variant extends SliceExecutionEvent
    ? Omit<Variant, 'runId' | 'slug' | 'seq' | 'ts' | 'coalesced' | 'truncated'>
    : never
  : never;

/** Tuning knobs for a {@link SliceEventBus} instance. */
export interface SliceEventBusOptions {
  /** Per-`execute` run identifier stamped on every event. */
  runId: string;
  /** The manifest slug stamped on every event. */
  slug: string;
  /**
   * Consumer callback. When absent the bus is a no-op: it still advances the
   * sequence counter but delivers nothing, so an uninstrumented `execute`
   * behaves exactly as before.
   */
  onEvent?: (event: SliceExecutionEvent) => void;
  /**
   * Maximum serialised size (string length, a byte proxy) of an event before
   * its string and string-array fields are truncated and the event is tagged
   * `truncated`. Default 8192.
   */
  maxPayloadBytes?: number;
  /**
   * How many events may sit in the buffer while {@link pause}d before the
   * oldest droppable event is coalesced away. Default 512.
   */
  bufferLimit?: number;
  /**
   * Event kinds that must never be dropped under backpressure. Defaults to the
   * terminal kinds — a consumer must not miss a completion, escalation,
   * cancellation, run end, or crash-recovery notice.
   */
  neverDrop?: readonly SliceExecutionEventKind[];
}

const DEFAULT_MAX_PAYLOAD_BYTES = 8192;
const DEFAULT_BUFFER_LIMIT = 512;
const DEFAULT_NEVER_DROP: readonly SliceExecutionEventKind[] = [
  'slice-completed',
  'slice-escalated',
  'slice-cancelled',
  'run-finished',
  'run-resume-after-crash',
];

const STAMP_KEYS = new Set(['kind', 'ts', 'runId', 'slug', 'seq', 'coalesced', 'truncated']);

/**
 * Single-consumer slice execution event stream (PQD-100).
 *
 * One bus is created per `SliceExecutor.execute` run. It stamps every event
 * with the run id, slug, a monotonically increasing `seq`, and an ISO
 * timestamp, enforces a per-event payload cap, and — when the consumer signals
 * backpressure via {@link pause} — coalesces the oldest droppable buffered
 * events while never dropping a terminal event. Delivery is synchronous and
 * callback-first; a callback that throws faults only that delivery and never
 * crashes the engine. The bus is not safe for concurrent `execute` calls on a
 * shared `SliceExecutor` instance, which the executor does not support either.
 */
export class SliceEventBus {
  private readonly runId: string;
  private readonly slug: string;
  private readonly onEvent?: (event: SliceExecutionEvent) => void;
  private readonly maxPayloadBytes: number;
  private readonly bufferLimit: number;
  private readonly neverDrop: ReadonlySet<SliceExecutionEventKind>;
  private readonly queue: SliceExecutionEvent[] = [];
  private seq = 0;
  private paused = false;
  private cancelled = false;

  constructor(options: SliceEventBusOptions) {
    this.runId = options.runId;
    this.slug = options.slug;
    this.onEvent = options.onEvent;
    this.maxPayloadBytes =
      options.maxPayloadBytes && options.maxPayloadBytes > 0
        ? options.maxPayloadBytes
        : DEFAULT_MAX_PAYLOAD_BYTES;
    this.bufferLimit =
      options.bufferLimit && options.bufferLimit > 0 ? options.bufferLimit : DEFAULT_BUFFER_LIMIT;
    this.neverDrop = new Set(options.neverDrop ?? DEFAULT_NEVER_DROP);
  }

  /** Stamp and emit an event. A no-op once {@link cancel} has been called. */
  emit(draft: SliceEventDraft): void {
    if (this.cancelled) {
      return;
    }
    this.dispatch(this.stamp(draft));
  }

  /**
   * Emit exactly one `slice-cancelled` event and stop the stream: any buffered
   * events are flushed first, then no further event is delivered.
   */
  cancel(): void {
    if (this.cancelled) {
      return;
    }
    this.flushQueue();
    const event = this.stamp({ kind: 'slice-cancelled', stoppedAtSeq: 0 });
    (event as SliceExecutionCancelledEvent).stoppedAtSeq = event.seq;
    this.cancelled = true;
    this.deliver(event);
  }

  /** Buffer subsequent events instead of delivering them immediately. */
  pause(): void {
    this.paused = true;
  }

  /** Resume immediate delivery and flush everything buffered while paused. */
  resume(): void {
    this.paused = false;
    this.flushQueue();
  }

  private stamp(draft: SliceEventDraft): SliceExecutionEvent {
    this.seq += 1;
    const event = {
      ...draft,
      runId: this.runId,
      slug: this.slug,
      seq: this.seq,
      ts: new Date().toISOString(),
    } as SliceExecutionEvent;
    return this.applyPayloadCap(event);
  }

  private dispatch(event: SliceExecutionEvent): void {
    if (this.paused) {
      this.enqueue(event);
      return;
    }
    this.deliver(event);
  }

  private enqueue(event: SliceExecutionEvent): void {
    if (!this.neverDrop.has(event.kind) && this.queue.length >= this.bufferLimit) {
      const dropIndex = this.queue.findIndex((queued) => !this.neverDrop.has(queued.kind));
      if (dropIndex !== -1) {
        this.queue.splice(dropIndex, 1);
        event.coalesced = true;
      }
    }
    this.queue.push(event);
  }

  private flushQueue(): void {
    while (this.queue.length > 0) {
      this.deliver(this.queue.shift() as SliceExecutionEvent);
    }
  }

  private deliver(event: SliceExecutionEvent): void {
    if (!this.onEvent) {
      return;
    }
    try {
      this.onEvent(event);
    } catch {
      // A faulting consumer must never crash the engine; drop this delivery
      // and let execution continue.
    }
  }

  private applyPayloadCap(event: SliceExecutionEvent): SliceExecutionEvent {
    if (JSON.stringify(event).length <= this.maxPayloadBytes) {
      return event;
    }
    const clone = { ...event } as Record<string, unknown>;
    for (const [key, value] of Object.entries(clone)) {
      if (STAMP_KEYS.has(key)) {
        continue;
      }
      if (typeof value === 'string' && value.length > 64) {
        clone[key] = `${value.slice(0, 64)}…[truncated]`;
      } else if (Array.isArray(value)) {
        clone[key] = value.map((item) =>
          typeof item === 'string' && item.length > 64 ? `${item.slice(0, 64)}…[truncated]` : item,
        );
      }
    }
    clone.truncated = true;
    return clone as unknown as SliceExecutionEvent;
  }
}
