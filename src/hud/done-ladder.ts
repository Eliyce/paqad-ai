export const DONE_RUNGS = ['done', 'committed', 'pr-open'] as const;

export type HudRung = (typeof DONE_RUNGS)[number];

export type LadderChecks = 'green' | 'red' | 'unknown';

export type LadderCi = 'pass' | 'fail' | 'pending' | 'unknown';

export interface DoneLadderInput {
  workKind: 'pass' | 'fail' | 'inconclusive' | null;
  checks: LadderChecks;
  uncommitted: boolean | null;
  commits: number;
  prState: 'open' | 'merged' | 'closed' | null;
  ci: string | null;
}

export interface DoneLadder {
  rung: HudRung | null;
  ci: LadderCi | null;
  ci_failed: boolean;
  uncommitted: boolean;
}

const KNOWN_CI: ReadonlySet<string> = new Set(['pass', 'fail', 'pending']);

function readCi(ci: string | null): LadderCi {
  return ci !== null && KNOWN_CI.has(ci) ? (ci as LadderCi) : 'unknown';
}

export function computeDoneLadder(input: DoneLadderInput): DoneLadder {
  const uncommitted = input.uncommitted === true;
  const none: DoneLadder = { rung: null, ci: null, ci_failed: false, uncommitted };
  if (input.workKind !== 'pass' || input.checks !== 'green') return none;
  if (input.prState === 'open') {
    const ci = readCi(input.ci);
    if (ci === 'fail') return { ...none, rung: 'committed', ci, ci_failed: true };
    return { ...none, rung: 'pr-open', ci };
  }
  if (input.commits > 0 && input.uncommitted === false) return { ...none, rung: 'committed' };
  return { ...none, rung: 'done' };
}
