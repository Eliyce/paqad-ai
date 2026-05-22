export const REVIEW_TIERS = ['full', 'standard', 'spot-check'] as const;
export type ReviewTier = (typeof REVIEW_TIERS)[number];

export const REVIEW_MODES = ['fresh', 'diff'] as const;
export type ReviewMode = (typeof REVIEW_MODES)[number];

export const REVIEW_DIMENSIONS = [
  'completeness',
  'assumption-safety',
  'security',
  'data-integrity',
  'performance',
  'failure-modes',
  'reuse-architecture',
  'database-quality',
  'ux-ui-quality',
  'test-quality',
  'observability',
  'rollback-safety',
] as const;
export type ReviewDimension = (typeof REVIEW_DIMENSIONS)[number];

export const TIER_DIMENSIONS: Record<ReviewTier, readonly ReviewDimension[]> = {
  full: REVIEW_DIMENSIONS,
  standard: [
    'completeness',
    'security',
    'data-integrity',
    'performance',
    'test-quality',
    'rollback-safety',
  ],
  'spot-check': ['security', 'test-quality', 'rollback-safety'],
};

export const FINDING_SEVERITIES = ['critical', 'high', 'medium', 'low'] as const;
export type FindingSeverity = (typeof FINDING_SEVERITIES)[number];

export interface ReviewFinding {
  id: string;
  dimension: ReviewDimension;
  severity: FindingSeverity;
  finding: string;
  impact: string;
  required_action: string;
}

export interface ReviewReport {
  point: 'after-spec' | 'after-implementation';
  tier: ReviewTier;
  mode: ReviewMode;
  verdict: 'pass' | 'fail';
  summary: string;
  findings: ReviewFinding[];
  dimensions_passed_clean: ReviewDimension[];
  dimensions_deferred: ReviewDimension[];
}
