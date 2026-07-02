// Analytics conflict → Decision Pause mapping (issue #241). The closed list of situations
// where the instrumentation agent stops and asks instead of guessing. Everything NOT here is
// "instrument correctly and show the one-line summary". Each conflict maps to a decision
// category (see DECISION_CATEGORIES) plus the plain-language question paqad surfaces.

import type { DecisionCategory } from '@/planning/decision-packet.js';

export type AnalyticsConflictKind =
  | 'provider_version_mismatch'
  | 'taxonomy_violation'
  | 'pii_consent'
  | 'no_provider_flag'
  | 'architecture_conflict';

export interface AnalyticsConflict {
  category: DecisionCategory;
  /** Plain-language framing of what paqad caught (no jargon). */
  title: string;
}

export const ANALYTICS_CONFLICTS: Record<AnalyticsConflictKind, AnalyticsConflict> = {
  provider_version_mismatch: {
    category: 'analytics.provider_version_mismatch',
    title: "I'm not sure which analytics tool (or version) this project uses — which is right?",
  },
  taxonomy_violation: {
    category: 'analytics.taxonomy_violation',
    title: 'This event name breaks your existing naming convention — keep mine or rename?',
  },
  pii_consent: {
    category: 'analytics.pii_consent',
    title: "This property looks like personal data — I won't auto-track it. Track it anyway?",
  },
  no_provider_flag: {
    category: 'analytics.no_provider_flag',
    title: 'Analytics is on but no provider is wired up — want me to set one up, or stay dormant?',
  },
  architecture_conflict: {
    category: 'analytics.architecture_conflict',
    title: 'Your module docs say tracking belongs elsewhere than this change — where should it go?',
  },
};

/** The decision category for a conflict kind. */
export function conflictCategory(kind: AnalyticsConflictKind): DecisionCategory {
  return ANALYTICS_CONFLICTS[kind].category;
}
