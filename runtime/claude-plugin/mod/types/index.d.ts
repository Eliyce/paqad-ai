// The paqad HUD mod's `$.state` contract (issue #639, Part 8), named as `types` in the plugin's
// `.claude-plugin/plugin.json`. Self-contained on purpose (no import, no reference), as Claude
// Code wants a plugin's contract to be.
//
// `PaqadHudSnapshot` is the part of `.paqad/session/hud/<session>.json` (schema `paqad.hud/2`,
// written by `src/hud/snapshot.ts`) the mod keeps, after `model.ts` has read it defensively.

export type PaqadTone = 'neutral' | 'working' | 'needs-you' | 'good' | 'warn' | 'bad';

export type PaqadHudStage = {
  stage: string;
  state: string;
  mandatory: boolean;
  started_at: string | null;
  ended_at: string | null;
  /** True when the fold found the stage's time implausible; the receipt reads it as marked. */
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

/** One part of the cost: its tokens and, when its model is priced, a dollar estimate. */
export type PaqadCostLine = { tokens: PaqadCostTokens; usd: number | null };

/**
 * What the change cost (issue #639, Part 23), from the bundle's cost.json. Money is an estimate
 * at API prices and is never shown without `label` and `price_table_date`.
 */
export type PaqadCost = {
  price_table_date: string;
  label: string;
  basis: string;
  plan_note: string;
  /** True when the window ends at the change's seal, false while it is still open. */
  sealed: boolean;
  tokens: PaqadCostTokens;
  /** The priced part in US dollars; null when nothing is priced. */
  usd: number | null;
  unpriced_models: string[];
  by_stage: Array<PaqadCostLine & { stage: string }>;
  by_expert: Array<PaqadCostLine & { role: string; exact: boolean }>;
  chief: (PaqadCostLine & { exact: boolean }) | null;
  not_counted: string[];
};

export type PaqadSeatState = 'seated' | 'writing' | 'done';

/** One seat at the High Table (issue #639, Parts 13 and 14), as the snapshot records it. */
export type PaqadSeat = {
  role: string;
  reason: string | null;
  /** Who seated it: `standing` or `detector`. */
  origin: string | null;
  state: PaqadSeatState;
  seated_at: string | null;
  started_at: string | null;
  done_at: string | null;
  /** The budget granted after the ceiling, and whether the ceiling cut it. */
  budget_tokens: number | null;
  clamped: boolean | null;
  /** The seat's own count, shown as an estimate; null before its note landed. */
  tokens_estimate: number | null;
  /** The host's usage for the seat's subagent; null when the host gave none. */
  tokens: PaqadCostTokens | null;
  tokens_exact: boolean;
  findings: number | null;
  /** True when its note landed after the spec was frozen. */
  late: boolean;
  /** The role's record on the project's earlier changes; null with no history. */
  track_record: PaqadTrackRecord | null;
};

/** How a role did on earlier changes: sat on, changed the spec on, had nothing to add on. */
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
  /** Disagreements settled before; `source` names the decision. */
  settled: Array<{ target: string; chosen: string; source: string }>;
};

/** The live High Table (issue #639, Part 13); `null` on the fast lane and with the experts off. */
export type PaqadHighTable = {
  skipped: boolean;
  met_after_freeze: boolean;
  seats: PaqadSeat[];
  chief: PaqadChief | null;
  rulings: PaqadRulings | null;
  gaps: Array<{ area: string; why_it_matters: string; question: string | null }>;
  questions: { asked: number; auto_answered: Array<{ question: string; source: string }> } | null;
  /** Who shaped each spec line: the line id and the expert roles behind it. */
  credits: Array<{ line: string; roles: string[] }>;
};

/** The paqad pane's tabs, in the order the tab row draws them (Part 14 adds the High Table). */
export type PaqadPaneTab = 'table' | 'cost';

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
  /** The live High Table (Parts 13 and 14); `null` on the fast lane and with the experts off. */
  table: PaqadHighTable | null;
  gates: Array<{ name: string; verdict: string }>;
  flags: Array<{ id: string; text: string }>;
  rules: { recorded: boolean; applicable: number | null; loaded_at: string | null };
  findings: { rules: PaqadFindingsScan; near_copies: PaqadFindingsScan } | null;
  decisions: {
    pending: Array<{ id: string; category: string; question: string }>;
    resolved: number;
  };
  /** The last rule stop (Part 18); `null` until that part records one. */
  last_block: { text: string } | null;
  ship: {
    commits: number;
    commit_decision: string | null;
    merge_commit: string | null;
    push: string | null;
    pr: string | null;
    ci: string | null;
  } | null;
  verdict: { word: string; kind: 'pass' | 'fail' | 'inconclusive'; reasons: string[] } | null;
  /** What the change cost (Part 23); `null` until a hook wrote it. */
  cost: PaqadCost | null;
};

/** Why the mod stands down; `null` while it is on. */
export type PaqadStandDown = 'view-off' | 'not-onboarded' | 'remote' | 'disabled' | 'old-engine';

export type PaqadStatus = { on: boolean; reason: PaqadStandDown | null };

declare module 'claude-code' {
  interface PluginState {
    paqad: {
      /** Decided at `session.start`; `null` until then. */
      status: PaqadStatus | null;
      /** The last snapshot read, or `null` when none could be read ("not yet"). */
      snapshot: PaqadHudSnapshot | null;
      /** Milliseconds at the last refresh or tick, for the Stage instrument's live clock. */
      now: number;
      /**
       * The pane tab the person picked (a tab Button or a pill that opens the pane), or `null`
       * while they picked none, when the pane opens on the High Table if the change has one.
       */
      paneTab: PaqadPaneTab | null;
      /** The High Table seat picked in the pane, by role; `null` shows the first seat. */
      tableSeat: string | null;
      /**
       * The first `paqad-ai spec pipeline experts` call of each change, by change id: the one
       * chat row the live High Table card is drawn over (Part 14).
       */
      tableCards: Record<string, string>;
    };
  }
}
