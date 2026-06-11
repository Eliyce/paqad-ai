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

/**
 * A single option carried on a {@link DecisionPausedEvent}. A serialisable
 * subset of the planning `DecisionOption` — enough for the desktop to render the
 * Decision Pause panel without a secondary filesystem read (PQD-101).
 */
export interface DecisionEventOption {
  option_key: string;
  label: string;
  one_line_preview: string;
  trade_off: string;
  technical_detail?: string;
}

/**
 * The engine paused for a human decision (the Decision Pause contract).
 *
 * PQD-99 introduced the minimal `decisionId`/`category`/`prompt` shape; PQD-101
 * enriches it (additively, all optional) with the full packet content so a
 * consumer can pop the packet UI live without reading
 * `.paqad/decisions/pending/` itself.
 */
export interface DecisionPausedEvent extends EngineEventBase {
  kind: 'decision-paused';
  decisionId: string;
  category?: string;
  prompt?: string;
  /** The packet question (the human-facing prompt text). */
  question?: string;
  /** The options offered, with their previews and trade-offs. */
  options?: DecisionEventOption[];
  /** The recommended option_key, if the packet carries one. */
  recommendation?: string | null;
  /** Why the recommendation was made, if provided. */
  recommendationReason?: string;
  /** Project-relative path to the on-disk pending packet JSON. */
  packetPath?: string;
  /** The slice this decision is linked to, if any. */
  linkedSliceId?: string;
}

/** A previously paused decision was resolved. */
export interface DecisionResolvedEvent extends EngineEventBase {
  kind: 'decision-resolved';
  decisionId: string;
  resolution?: string;
  /** The chosen option_key (null when the resolution declined to choose). */
  chosenOptionKey?: string | null;
  /** Who/what resolved it: `human`, `rule`, `rag-confident`, `memoization`, … */
  resolver?: string;
  /** The recorded resolution intent (`explicit`, `safer-default`, …). */
  intent?: string;
}

/**
 * The engine read a pending packet and found it malformed (PQD-101). Lets a
 * consumer show a "decision was lost" notice instead of crashing.
 */
export interface DecisionPacketCorruptEvent extends EngineEventBase {
  kind: 'decision-packet-corrupt';
  decisionId: string;
  reason: string;
}

/**
 * A new pause would exceed the per-project pending-packet cap, so the engine
 * refused to create the packet (PQD-101). Lets a consumer prompt the user to
 * triage the existing pending packets.
 */
export interface DecisionCapExceededEvent extends EngineEventBase {
  kind: 'decision-cap-exceeded';
  pendingCount: number;
  cap: number;
}

/**
 * A consumer explicitly discarded a pending packet with a reason (PQD-101). No
 * fake resolution is written; the panel can close cleanly.
 */
export interface DecisionDiscardedEvent extends EngineEventBase {
  kind: 'decision-discarded';
  decisionId: string;
  reason: string;
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

/** A single gate's outcome carried on a {@link VerificationVerdictEvent}. */
export interface VerificationGateVerdictEntry {
  gate: string;
  status: 'pass' | 'fail' | 'inconclusive' | 'skipped';
  detail: string;
}

/**
 * A verification run (issue #117) finished — fired by the completion hook / CI
 * backstop. Carries the one trust verdict so a desktop/UI subscriber renders
 * "did the agent obey?" without re-reading the diff. `ok` is the deterministic
 * pass/fail; `gates` carries per-gate specifics; `escalations` lists signals
 * that could not be proven and need a human.
 */
export interface VerificationVerdictEvent extends EngineEventBase {
  kind: 'verification-verdict';
  origin: string;
  ok: boolean;
  summary: string;
  gates: VerificationGateVerdictEntry[];
  escalations: string[];
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
  | DecisionPacketCorruptEvent
  | DecisionCapExceededEvent
  | DecisionDiscardedEvent
  | RetrievalStartedEvent
  | RetrievalCompletedEvent
  | WorkflowStepStartedEvent
  | WorkflowStepCompletedEvent
  | WorkflowStepFailedEvent
  | RegistryChangedEvent
  | VerificationVerdictEvent
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
