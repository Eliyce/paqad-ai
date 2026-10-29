export type LiveState = {
  turnId: string | null;
  turnStartedAt: number | null;
  editing: { toolUseId: string | null; file: string | null } | null;
  waitingOn: 'question' | null;
  waitingToolUseId: string | null;
  agents?: PaqadAgentsLive;
};

export type PaqadAgentsLive = {
  running: Array<{ id: string; description: string; status: string }>;
  lines: string[];
  finished: number;
};

export type PaqadTone = 'neutral' | 'working' | 'needs-you' | 'good' | 'warn' | 'bad';

export type PaqadHudStage = {
  stage: string;
  state: string;
  mandatory: boolean;
  started_at: string | null;
  ended_at: string | null;
  duration_unreliable: boolean;
  duration_ms: number | null;
  agent: string | null;
};

export type PaqadDeliveryPlan = {
  commit: boolean;
  push: boolean;
  pr: boolean;
  ci: boolean;
  merge: boolean;
  reason: string | null;
};

export type PaqadPlanProgress = { steps: number; done: number };

export type PaqadFindingsScan = {
  status: 'open' | 'clean' | 'did not run';
  total: number | null;
  blocking: boolean;
};

export type PaqadCostTokens = {
  input: number;
  output: number;
  cache_read: number;
  cache_write: number;
  total: number;
};

export type PaqadCostLine = { tokens: PaqadCostTokens; usd: number | null };

export type PaqadCostScope = 'change' | 'whole-session';

export type PaqadCost = {
  scope: PaqadCostScope;
  price_table_date: string;
  label: string;
  basis: string;
  plan_note: string;
  sealed: boolean;
  tokens: PaqadCostTokens;
  usd: number | null;
  unpriced_models: string[];
  by_stage: Array<PaqadCostLine & { stage: string }>;
  by_expert: Array<PaqadCostLine & { role: string; exact: boolean }>;
  chief: (PaqadCostLine & { exact: boolean }) | null;
  not_counted: string[];
  live: boolean;
};

export type PaqadSeatState = 'seated' | 'writing' | 'done';

export type PaqadSeat = {
  role: string;
  reason: string | null;
  origin: string | null;
  state: PaqadSeatState;
  seated_at: string | null;
  started_at: string | null;
  done_at: string | null;
  budget_tokens: number | null;
  clamped: boolean | null;
  tokens_estimate: number | null;
  tokens: PaqadCostTokens | null;
  tokens_exact: boolean;
  findings: number | null;
  late: boolean;
  track_record: PaqadTrackRecord | null;
};

export type PaqadTrackRecord = {
  changes: number;
  changed_spec: number;
  empty: number;
  avg_tokens: number;
};

export type PaqadChief = PaqadSeat & { verdict: string | null };

export type PaqadRulings = {
  accepted: string[];
  declined: Array<{ id: string; reason: string }>;
  conflicts: Array<{ target: string; recommendation: string; rationale: string }>;
  merged: Array<{ target: string; merged_claim: string; rationale: string }>;
  renames: Array<{ id: string; target: string }>;
  settled: Array<{ target: string; chosen: string; source: string }>;
};

export type PaqadHighTable = {
  skipped: boolean;
  met_after_freeze: boolean;
  seats: PaqadSeat[];
  chief: PaqadChief | null;
  rulings: PaqadRulings | null;
  gaps: Array<{ area: string; why_it_matters: string; question: string | null }>;
  questions: { asked: number; auto_answered: Array<{ question: string; source: string }> } | null;
  credits: Array<{ line: string; roles: string[] }>;
};

export type PaqadPaneTab = 'table' | 'cost' | 'trust' | 'ships' | 'record';

export type TableSitting = {
  key: string;
  forwarded: boolean;
  picked: boolean;
};

export type PaqadLastBlock = {
  text: string;
  rule?: string;
  title?: string;
  file?: string;
  tool_use_id?: string;
  managed?: boolean;
  at?: string;
  token?: string;
  used?: boolean;
};

export type PaqadCommitGroup = {
  count: number;
  tickets: string[];
  merges: number;
  untagged: number;
};

export type PaqadGateStrength = 'deterministic' | 'llm-judged' | null;

export type PaqadGateOwner = 'work' | 'paqad-record';

export type PaqadGate = {
  name: string;
  verdict: string;
  required: boolean;
  strength: PaqadGateStrength;
  owner?: PaqadGateOwner;
};

export type PaqadRepair = { what: string; at: string | null };

export type PaqadProofStep = {
  id: string;
  words: string;
  detail: string | null;
  state: 'done' | 'failed' | 'not-yet';
};

export type PaqadProofGate = { code: string; words: string; state: string };

export type PaqadStageProof = {
  stage: string;
  words: string;
  state: string;
  steps: PaqadProofStep[];
  gates: PaqadProofGate[];
};

export type PaqadRung = 'done' | 'committed' | 'pr-open';

export type PaqadHeadline = {
  text: string;
  tone: PaqadTone;
  row?: number;
  word?: string;
  rung?: PaqadRung;
  note?: string;
  gap?: string;
  clock_from?: string;
};

export type PaqadClaim = {
  kind: string;
  id: string | null;
  label: string;
  verdict: string;
  test_id: string | null;
};

export type PaqadCiJob = {
  name: string;
  status: string | null;
  conclusion: string | null;
  started_at: string | null;
  completed_at: string | null;
};

export type PaqadCi = {
  state: string;
  done: number | null;
  total: number | null;
  reason: string | null;
  jobs: PaqadCiJob[];
};

export type PaqadTimelineEntry = {
  at: string;
  kind: string;
  stage: string | null;
  note: string | null;
  agent?: string;
  own_agent?: boolean;
  duration_ms?: number;
  count?: number;
  picked?: number;
  standing?: number;
  findings?: number;
  verdict?: string;
  title?: string;
  issue?: string;
  lane?: string;
  sha?: string;
  subject?: string;
  decision?: string;
  number?: number;
  requirements?: number;
  criteria?: number;
  state?: string;
};

export type PaqadShipCommit = { sha: string; subject: string; own: boolean | null };

export type PaqadPrState = 'open' | 'merged' | 'closed';

export type PaqadScope = { qualified: boolean; reason: string };

export type PaqadWorkflow = {
  name: string;
  started_at: string | null;
  tokens: number | null;
  usd: number | null;
  unpriced: string[];
};

export type PaqadHudSnapshot = {
  session_id: string;
  generated_at: string;
  scope: PaqadScope;
  workflow: PaqadWorkflow | null;
  active: boolean;
  route: string | null;
  lane: string | null;
  lane_stages?: string[];
  lane_reason: string | null;
  headline: PaqadHeadline;
  change: {
    dir: string | null;
    id: string | null;
    issue: string | null;
    title: string | null;
    branch: string | null;
  } | null;
  paused: Array<{ workflow: string; lane: string | null }>;
  stages: PaqadHudStage[];
  timeline: PaqadTimelineEntry[];
  table: PaqadHighTable | null;
  gates: PaqadGate[];
  gates_expected: string[];
  claims: PaqadClaim[];
  bundle_files: string[];
  flags: Array<{ id: string; text: string }>;
  rules: { recorded: boolean; applicable: number | null; loaded_at: string | null };
  findings: { rules: PaqadFindingsScan; near_copies: PaqadFindingsScan } | null;
  decisions: {
    pending: Array<{ id: string; category: string; question: string }>;
    resolved: number;
  };
  last_block: PaqadLastBlock | null;
  delivery_plan: PaqadDeliveryPlan | null;
  plan: PaqadPlanProgress | null;
  ship: {
    commits: number;
    commit_decision: string | null;
    merge_commit: string | null;
    push: string | null;
    pr: string | null;
    ci: string | null;
    push_branch?: string | null;
    pr_url?: string | null;
    ci_detail?: PaqadCi | null;
    own?: PaqadCommitGroup | null;
    inherited?: PaqadCommitGroup | null;
    commit_list: PaqadShipCommit[];
    inherited_count: number;
    pr_number: number | null;
    pr_state: PaqadPrState | null;
    pr_head: string | null;
    pr_title: string | null;
    pr_files: number | null;
    pr_additions: number | null;
    pr_deletions: number | null;
    files_changed: number | null;
    ci_read_at: string | null;
    all_green: boolean;
    merged: boolean;
  } | null;
  verdict: {
    word: string;
    kind: 'pass' | 'fail' | 'inconclusive';
    reasons: string[];
    at?: string;
    work_kind?: 'pass' | 'fail' | 'inconclusive';
    work_reasons?: string[];
    record_gaps?: string[];
  } | null;
  receipt: { path: string } | null;
  cost: PaqadCost | null;
  record_gaps?: string[];
  repairs?: PaqadRepair[];
  rung?: PaqadRung;
  verdict_stale?: true;
  start_point?: PaqadStartPoint | null;
  proof?: PaqadStageProof[];
};

export type PaqadStartPoint = {
  source: 'start_commit' | 'fork-point' | 'fallback-base';
  base: string | null;
  files_known: boolean;
};

export type PaqadStandDown = 'view-off' | 'not-onboarded' | 'remote' | 'disabled' | 'old-engine';

export type PaqadStatus = { on: boolean; reason: PaqadStandDown | null };

declare module 'claude-code' {
  interface PluginState {
    paqad: {
      status: PaqadStatus | null;
      snapshot: PaqadHudSnapshot | null;
      now: number;
      paneTab: PaqadPaneTab | null;
      greenSeen: string[];
      settleSeen: Record<string, number | null>;
      agentsFinished: Record<string, string[]>;
      paneOpen: boolean;
      unavailable: boolean;
      unbound: boolean;
      minimised: boolean;
      hidden: boolean;
      bandClosed: boolean;
      tableSeat: string | null;
      tableCards: Record<string, string>;
      tick: number;
      closing: boolean;
      tableSides: boolean;
      live: LiveState;
      tableSitting: TableSitting | null;
    };
  }
}
