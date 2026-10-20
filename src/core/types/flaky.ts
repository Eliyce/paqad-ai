import type { TestIssueSnapshot } from './token-efficiency.js';
import type { VerificationEvidenceFailure } from './verification-evidence.js';

export const FLAKY_REGISTRY_SCHEMA_VERSION = '1.0.0' as const;

export const DEFAULT_STABILITY_RERUNS = 3;

export const MIN_STABILITY_RERUNS = 2;
export const MAX_STABILITY_RERUNS = 10;

export const FLAKINESS_SMELLS = [
  'timing',
  'order-dependence',
  'shared-state',
  'network-io',
  'randomness',
] as const;
export type FlakinessSmell = (typeof FLAKINESS_SMELLS)[number];

export interface FlakinessSmellHit {
  smell: FlakinessSmell;
  signal: string;
}

export const STABILITY_VERDICTS = ['real', 'flaky', 'recovered'] as const;
export type StabilityVerdict = (typeof STABILITY_VERDICTS)[number];

export interface StabilityRun {
  passed: boolean;
}

export interface StabilityJudgement {
  test_id: string;
  verdict: StabilityVerdict;
  reruns: number;
  passes: number;
  failures: number;
}

export const QUARANTINE_STATUSES = ['quarantined', 'cleared'] as const;
export type QuarantineStatus = (typeof QUARANTINE_STATUSES)[number];

export interface FlakyRegistryEntry {
  test_id: string;
  suite: string | null;
  status: QuarantineStatus;
  first_seen: string;
  updated_at: string;
  evidence: {
    reruns: number;
    passes: number;
    failures: number;
  };
  suspected_causes: FlakinessSmell[];
  modules: string[];
  cleared_reason?: string;
}

export interface FlakyRegistry {
  schema_version: typeof FLAKY_REGISTRY_SCHEMA_VERSION;
  updated_at: string;
  entries: FlakyRegistryEntry[];
}

export interface AnnotatedFailure extends VerificationEvidenceFailure {
  quarantined: boolean;
  flaky: boolean;
}

export interface QuarantineApplication {
  blocking: AnnotatedFailure[];
  quarantined: AnnotatedFailure[];
  active_quarantines: string[];
  meaningful_green: boolean;
}

export interface QuarantineDebt {
  test_id: string;
  suite: string | null;
  module: string;
  suspected_causes: FlakinessSmell[];
}

export const FORCED_FIX_LANES = ['graduated', 'full'] as const;
export type ForcedFixLane = (typeof FORCED_FIX_LANES)[number];

export interface TouchGateResult {
  blocked: boolean;
  touched_modules: string[];
  debts: QuarantineDebt[];
  reason: 'fast-lane-skipped' | 'no-debt' | 'forced-fix';
}

export interface ModuleQuarantineCount {
  module: string;
  quarantined: number;
}

export type { TestIssueSnapshot };
