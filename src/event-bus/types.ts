/**
 * Engine event-stream contract (PQD-99).
 *
 * A single in-process subscription surface that delivers every event the engine
 * emits — slice execution, decision pauses, retrieval activity, workflow steps,
 * and registry changes — in occurrence order, without polling. Consumers
 * (the desktop app via its Electron preload bridge, the API layer) subscribe
 * once and receive a serialisable {@link EngineEvent} for every domain.
 *
 * Every variant carries:
 * - a `kind` discriminant (see {@link EngineEventKind}), and
 * - an `at` ISO-8601 timestamp stamped by the engine at emit time.
 *
 * Payloads are plain data only (no class instances, no circular references) so
 * the preload layer can forward them over IPC to the renderer untransformed.
 */

/** Fields shared by every engine event variant. */
export interface EngineEventBase {
  /** ISO-8601 timestamp stamped by the engine when the event is emitted. */
  at: string;
  /**
   * Set when the event's string payload exceeded the bus's `maxPayloadBytes`
   * budget and was truncated to keep delivery cheap. The event is delivered
   * rather than rejected; consumers should treat truncated fields as elided.
   */
  truncated?: boolean;
}

/** A planning/agentic slice began executing. */
export interface SliceStartedEvent extends EngineEventBase {
  kind: 'slice-started';
  runId: string;
  sliceId: string;
  index?: number;
}

/** A planning/agentic slice finished successfully. */
export interface SliceCompletedEvent extends EngineEventBase {
  kind: 'slice-completed';
  runId: string;
  sliceId: string;
  durationMs?: number;
}

/** A planning/agentic slice failed. */
export interface SliceFailedEvent extends EngineEventBase {
  kind: 'slice-failed';
  runId: string;
  sliceId: string;
  error: string;
}

/** The engine paused for a human decision (the Decision Pause contract). */
export interface DecisionPausedEvent extends EngineEventBase {
  kind: 'decision-paused';
  decisionId: string;
  category?: string;
  prompt?: string;
}

/** A previously paused decision was resolved. */
export interface DecisionResolvedEvent extends EngineEventBase {
  kind: 'decision-resolved';
  decisionId: string;
  resolution?: string;
}

/** A retrieval (RAG) query started. */
export interface RetrievalStartedEvent extends EngineEventBase {
  kind: 'retrieval-started';
  queryId: string;
  query?: string;
}

/** A retrieval (RAG) query completed. */
export interface RetrievalCompletedEvent extends EngineEventBase {
  kind: 'retrieval-completed';
  queryId: string;
  resultCount?: number;
}

/** A workflow step began running. */
export interface WorkflowStepStartedEvent extends EngineEventBase {
  kind: 'workflow-step-started';
  runId: string;
  stepIndex: number;
  skill: string | null;
}

/** A workflow step completed (or was skipped). */
export interface WorkflowStepCompletedEvent extends EngineEventBase {
  kind: 'workflow-step-completed';
  runId: string;
  stepIndex: number;
  skill: string | null;
}

/** A workflow step failed. */
export interface WorkflowStepFailedEvent extends EngineEventBase {
  kind: 'workflow-step-failed';
  runId: string;
  stepIndex: number;
  skill: string | null;
  error: string;
}

/** A runtime registry (skills, packs, tools, MCP servers) changed. */
export interface RegistryChangedEvent extends EngineEventBase {
  kind: 'registry-changed';
  registry: string;
  change: 'added' | 'removed' | 'updated';
  id?: string;
}

/**
 * Synthetic event delivered to a subscriber whose buffer overflowed: the bus
 * dropped `droppedCount` older non-critical events before this marker. It is
 * itself never dropped.
 */
export interface EventsCoalescedEvent extends EngineEventBase {
  kind: 'events-coalesced';
  droppedCount: number;
}

/**
 * Discriminated union of every event the engine can emit. New domains add a
 * variant here and a `kind` literal; consumers switch on `kind`.
 */
export type EngineEvent =
  | SliceStartedEvent
  | SliceCompletedEvent
  | SliceFailedEvent
  | DecisionPausedEvent
  | DecisionResolvedEvent
  | RetrievalStartedEvent
  | RetrievalCompletedEvent
  | WorkflowStepStartedEvent
  | WorkflowStepCompletedEvent
  | WorkflowStepFailedEvent
  | RegistryChangedEvent
  | EventsCoalescedEvent;

/** The set of `kind` discriminants, for use in {@link EngineEventFilter}. */
export type EngineEventKind = EngineEvent['kind'];

/** A subscription filter: only events whose `kind` is listed are delivered. */
export interface EngineEventFilter {
  kinds: readonly EngineEventKind[];
}

/** The lifecycle state of a subscription. */
export type SubscriptionState = 'active' | 'faulted' | 'cancelled';

/**
 * Handle returned by `subscribe()`. `state` is a live view of the underlying
 * subscription; `unsubscribe()` stops delivery and releases backing resources.
 */
export interface Subscription {
  readonly id: string;
  readonly state: SubscriptionState;
  unsubscribe(): void;
}

/**
 * A subscriber callback. Must be synchronous from the engine's perspective —
 * the bus never awaits it. The `void` return type discourages passing an async
 * function (whose Promise the bus would otherwise ignore).
 */
export type EngineEventCallback = (event: EngineEvent) => void;
