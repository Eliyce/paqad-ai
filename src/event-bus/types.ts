export interface EngineEventBase {
  at: string;
  truncated?: boolean;
}

export interface SliceStartedEvent extends EngineEventBase {
  kind: 'slice-started';
  runId: string;
  sliceId: string;
  index?: number;
}

export interface SliceCompletedEvent extends EngineEventBase {
  kind: 'slice-completed';
  runId: string;
  sliceId: string;
  durationMs?: number;
}

export interface SliceFailedEvent extends EngineEventBase {
  kind: 'slice-failed';
  runId: string;
  sliceId: string;
  error: string;
}

export interface DecisionEventOption {
  option_key: string;
  label: string;
  one_line_preview: string;
  trade_off: string;
  technical_detail?: string;
}

export interface DecisionPausedEvent extends EngineEventBase {
  kind: 'decision-paused';
  decisionId: string;
  category?: string;
  prompt?: string;
  question?: string;
  options?: DecisionEventOption[];
  recommendation?: string | null;
  recommendationReason?: string;
  packetPath?: string;
  linkedSliceId?: string;
}

export interface DecisionResolvedEvent extends EngineEventBase {
  kind: 'decision-resolved';
  decisionId: string;
  resolution?: string;
  chosenOptionKey?: string | null;
  resolver?: string;
  intent?: string;
}

export interface DecisionPacketCorruptEvent extends EngineEventBase {
  kind: 'decision-packet-corrupt';
  decisionId: string;
  reason: string;
}

export interface DecisionCapExceededEvent extends EngineEventBase {
  kind: 'decision-cap-exceeded';
  pendingCount: number;
  cap: number;
}

export interface DecisionDiscardedEvent extends EngineEventBase {
  kind: 'decision-discarded';
  decisionId: string;
  reason: string;
}

export interface RetrievalStartedEvent extends EngineEventBase {
  kind: 'retrieval-started';
  queryId: string;
  query?: string;
}

export interface RetrievalCompletedEvent extends EngineEventBase {
  kind: 'retrieval-completed';
  queryId: string;
  resultCount?: number;
}

export interface WorkflowStepStartedEvent extends EngineEventBase {
  kind: 'workflow-step-started';
  runId: string;
  stepIndex: number;
  skill: string | null;
}

export interface WorkflowStepCompletedEvent extends EngineEventBase {
  kind: 'workflow-step-completed';
  runId: string;
  stepIndex: number;
  skill: string | null;
}

export interface WorkflowStepFailedEvent extends EngineEventBase {
  kind: 'workflow-step-failed';
  runId: string;
  stepIndex: number;
  skill: string | null;
  error: string;
}

export interface RegistryChangedEvent extends EngineEventBase {
  kind: 'registry-changed';
  registry: string;
  change: 'added' | 'removed' | 'updated';
  id?: string;
}

export interface VerificationGateVerdictEntry {
  gate: string;
  status: 'pass' | 'fail' | 'inconclusive' | 'skipped';
  detail: string;
}

export interface VerificationVerdictEvent extends EngineEventBase {
  kind: 'verification-verdict';
  origin: string;
  ok: boolean;
  summary: string;
  gates: VerificationGateVerdictEntry[];
  escalations: string[];
}

export interface EventsCoalescedEvent extends EngineEventBase {
  kind: 'events-coalesced';
  droppedCount: number;
}

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

export type EngineEventKind = EngineEvent['kind'];

export interface EngineEventFilter {
  kinds: readonly EngineEventKind[];
}

export type SubscriptionState = 'active' | 'faulted' | 'cancelled';

export interface Subscription {
  readonly id: string;
  readonly state: SubscriptionState;
  unsubscribe(): void;
}

export type EngineEventCallback = (event: EngineEvent) => void;
