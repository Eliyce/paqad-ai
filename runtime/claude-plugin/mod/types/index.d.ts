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
    };
  }
}
