export const STAGE_IDS = [
  'detect',
  'setup',
  'project_docs',
  'module_docs',
  'rules_discovery',
  'rules_analyze',
  'rule_scripts',
  'finish',
] as const;
export type StageId = (typeof STAGE_IDS)[number];

export const DEGRADED_CODES = [
  'stack_mismatch_noted',
  'git_workflow_kept',
  'research_offline',
  'research_stopped',
  'rag_off',
] as const;
export type DegradedCode = (typeof DEGRADED_CODES)[number];

export type StageStatus = 'not_started' | 'running' | 'done' | 'degraded' | 'failed';
export type RunStatus = 'running' | 'paused' | 'failed' | 'done' | 'abandoned';
export type StageRunsIn = 'cli' | 'agent';

export interface StageDefinition {
  id: StageId;
  index: number;
  name: string;
  label: string;
  running: string;
  workflow: string;
  runs_in: StageRunsIn;
  agent: string | null;
  unit: { one: string; many: string } | null;
  allowed_degraded: readonly DegradedCode[];
}

export interface StageRecord {
  status: StageStatus;
  started_at?: string;
  ended_at?: string;
  degraded?: DegradedCode[];
  failure?: string;
  plan?: string[];
  planned?: number;
}

export interface DetectionRecord {
  stack: string;
  capabilities: string[];
  source: 'detector' | 'ai';
  reason: string;
  detected_at: string;
  candidates?: string[];
}

export interface SetupRecord {
  completed_at: string;
  generated_files: string[];
  step_failures: Array<{ step: string; message: string }>;
  rag: 'ready' | 'deferred' | 'off';
}

export interface CommitRecord {
  answer: 'branch' | 'later' | 'no';
  answered_at: string;
  branch?: string;
  sha?: string;
  committed?: string[];
  left_out?: Array<{ path: string; reason: string }>;
}

export interface JourneyRun {
  schema_version: 1;
  run_id: string;
  revision: number;
  status: RunStatus;
  owner_session: string;
  providers: string[];
  allow_list: boolean;
  asked: 'tray' | 'agent-attested';
  created_at: string;
  updated_at: string;
  stages: Record<StageId, StageRecord>;
  written: Record<string, string>;
  setup_hashes: Record<string, string>;
  rules_before?: string[];
  rule_checks_flagged?: string[];
  baseline: Record<string, string | null>;
  docs_baseline?: Record<string, string>;
  detection?: DetectionRecord;
  setup?: SetupRecord;
  commit?: CommitRecord;
  abandoned_at?: string;
}

export type JourneyEventKind =
  | 'stage'
  | 'unit'
  | 'unit_kept'
  | 'progress'
  | 'agent_start'
  | 'agent_bind'
  | 'agent_stop'
  | 'handover'
  | 'heartbeat';

export interface JourneyEvent {
  ts: string;
  run_id: string;
  kind: JourneyEventKind;
  stage?: StageId;
  unit?: string;
  outputs?: Record<string, string>;
  source_hash?: string;
  done?: number;
  total?: number;
  session?: string;
  agent?: string;
  agent_id?: string;
  action?: string;
  note?: string;
}

export interface ChoiceRow {
  id: string;
  ts: string;
  run_id: string;
  stage: StageId | 'start';
  kind: string;
  choice: string;
  reason: string;
  by: 'paqad-onboarding' | 'tray' | 'agent-attested' | 'person';
  decision_id?: string;
  details?: Record<string, unknown>;
  reviewed?: boolean;
  reviewed_at?: string;
}
