import type { PaqadHudSnapshot } from './types';

export const FEATURE_SCOPE_REASONS = [
  'qualified',
  'finished',
  'no-active-change',
  'no-change-yet',
  'closed',
  'other-branch',
  'not-feature-route',
  'no-row-this-episode',
] as const;

export type FeatureScopeReason = (typeof FEATURE_SCOPE_REASONS)[number];

export type FeatureScopeRow =
  | { kind: 'band' }
  | { kind: 'ready' }
  | { kind: 'closed' }
  | { kind: 'other-branch'; branch: string | null }
  | { kind: 'paused' };

export const PAUSED_WORD = 'Paused';
export const PAUSED_WORDS = 'A change is paused. Say "continue" to pick it up.';
export const OTHER_BRANCH_WORD = 'Other branch';
export const CHANGE_CLOSED_WORD = 'Change closed';

export function otherBranchWords(branch: string | null): string {
  return branch ? `The change is on branch ${branch}` : 'The change is on another branch';
}

const READY: FeatureScopeRow = { kind: 'ready' };

export const FEATURE_SCOPE_ROWS: Readonly<
  Record<FeatureScopeReason, (snapshot: PaqadHudSnapshot) => FeatureScopeRow>
> = {
  qualified: () => ({ kind: 'band' }),
  finished: () => ({ kind: 'band' }),
  'no-active-change': () => READY,
  'no-change-yet': () => READY,
  closed: () => ({ kind: 'closed' }),
  'other-branch': (snapshot) => ({ kind: 'other-branch', branch: snapshot.scope.branch ?? null }),
  'not-feature-route': () => READY,
  'no-row-this-episode': (snapshot) => (snapshot.paused.length > 0 ? { kind: 'paused' } : READY),
};

function isFeatureScopeReason(reason: string): reason is FeatureScopeReason {
  return (FEATURE_SCOPE_REASONS as readonly string[]).includes(reason);
}

export function featureScopeRow(snapshot: PaqadHudSnapshot): FeatureScopeRow {
  if (snapshot.closed_change) return { kind: 'closed' };
  const reason = snapshot.scope?.reason ?? 'no-change-yet';
  const row = isFeatureScopeReason(reason) ? FEATURE_SCOPE_ROWS[reason](snapshot) : READY;
  return row.kind === 'band' ? READY : row;
}

export function scopeRowWords(row: Exclude<FeatureScopeRow, { kind: 'band' | 'ready' }>): {
  word: string;
  words: string;
} {
  switch (row.kind) {
    case 'closed':
      return { word: CHANGE_CLOSED_WORD, words: '' };
    case 'other-branch':
      return { word: OTHER_BRANCH_WORD, words: otherBranchWords(row.branch) };
    case 'paused':
      return { word: PAUSED_WORD, words: PAUSED_WORDS };
  }
}
