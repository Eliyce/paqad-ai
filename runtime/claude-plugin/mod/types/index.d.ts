export type PaqadTone = 'neutral' | 'working' | 'needs-you' | 'good' | 'warn' | 'bad';

export type PaqadHudStage = {
  stage: string;
  state: string;
  mandatory: boolean;
  started_at: string | null;
  ended_at: string | null;
  duration_unreliable: boolean;
};

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

export type PaqadCost = {
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

export type PaqadPaneTab = 'table' | 'cost';

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

export type PaqadHudSnapshot = {
  session_id: string;
  generated_at: string;
  active: boolean;
  route: string | null;
  lane: string | null;
  lane_reason: string | null;
  headline: { text: string; tone: PaqadTone };
  change: {
    id: string | null;
    issue: string | null;
    title: string | null;
    branch: string | null;
  } | null;
  paused: Array<{ workflow: string; lane: string | null }>;
  stages: PaqadHudStage[];
  table: PaqadHighTable | null;
  gates: Array<{ name: string; verdict: string }>;
  flags: Array<{ id: string; text: string }>;
  rules: { recorded: boolean; applicable: number | null; loaded_at: string | null };
  findings: { rules: PaqadFindingsScan; near_copies: PaqadFindingsScan } | null;
  decisions: {
    pending: Array<{ id: string; category: string; question: string }>;
    resolved: number;
  };
  last_block: PaqadLastBlock | null;
  ship: {
    commits: number;
    commit_decision: string | null;
    merge_commit: string | null;
    push: string | null;
    pr: string | null;
    ci: string | null;
    own?: PaqadCommitGroup | null;
    inherited?: PaqadCommitGroup | null;
  } | null;
  verdict: { word: string; kind: 'pass' | 'fail' | 'inconclusive'; reasons: string[] } | null;
  cost: PaqadCost | null;
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
      tableSeat: string | null;
      tableCards: Record<string, string>;
    };
  }
}
