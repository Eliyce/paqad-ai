import type { TestIssueSnapshot } from './token-efficiency.js';
import type { VerificationEvidenceFailure } from './verification-evidence.js';

// Issue #106 — keep a green result trustworthy. A check is only labelled flaky
// after a real cause is ruled out (assume-real-first); a confirmed flaky test is
// quarantined so it stops blocking AND stops giving false comfort, stays visibly
// tracked, and is forced to be fixed the next time related code is touched.

/** Schema version for the persisted flaky-test registry. */
export const FLAKY_REGISTRY_SCHEMA_VERSION = '1.0.0' as const;

/** Default number of bounded stability re-runs when the project does not tune it. */
export const DEFAULT_STABILITY_RERUNS = 3;

/** Lower / upper bounds on the configurable re-run count (keeps CI cost bounded). */
export const MIN_STABILITY_RERUNS = 2;
export const MAX_STABILITY_RERUNS = 10;

/**
 * The kinds of non-determinism that commonly cause flakiness. Surfaced from the
 * test so the root cause can be fixed rather than the symptom papered over.
 */
export const FLAKINESS_SMELLS = [
  'timing',
  'order-dependence',
  'shared-state',
  'network-io',
  'randomness',
] as const;
export type FlakinessSmell = (typeof FLAKINESS_SMELLS)[number];

/** A single detected root-cause smell with the evidence that triggered it. */
export interface FlakinessSmellHit {
  smell: FlakinessSmell;
  /** The token/pattern that matched (e.g. `Date.now`, `Math.random`). */
  signal: string;
}

/**
 * The verdict of judging a failure's stability by controlled re-runs on the same
 * tree with no code change.
 *
 * - `real` — failed on every re-run; treated as a genuine fault (assume-real-first).
 * - `flaky` — flipped (passed at least once and failed at least once) with no code
 *   change; a confirmed candidate for quarantine.
 * - `recovered` — passed on every re-run; the original failure did not reproduce
 *   (still not silently dismissed — surfaced for inspection).
 */
export const STABILITY_VERDICTS = ['real', 'flaky', 'recovered'] as const;
export type StabilityVerdict = (typeof STABILITY_VERDICTS)[number];

/** Outcome of a single stability re-run for one test. */
export interface StabilityRun {
  /** Whether the test passed on this re-run. */
  passed: boolean;
}

/** The full result of judging one test's stability. */
export interface StabilityJudgement {
  test_id: string;
  verdict: StabilityVerdict;
  /** How many re-runs were performed (bounded by the configured count). */
  reruns: number;
  passes: number;
  failures: number;
}

/** Lifecycle status of a registry entry. */
export const QUARANTINE_STATUSES = ['quarantined', 'cleared'] as const;
export type QuarantineStatus = (typeof QUARANTINE_STATUSES)[number];

/**
 * One entry in the flaky-test registry. Keyed by `test_id` + `suite` (the stable
 * ids from `test-output/service.ts`). A quarantined entry stops blocking the gate
 * and stops counting as meaningful green, but is never deleted — only marked.
 */
export interface FlakyRegistryEntry {
  test_id: string;
  suite: string | null;
  status: QuarantineStatus;
  /** ISO timestamp the test was first confirmed flaky. */
  first_seen: string;
  /** ISO timestamp of the last status change. */
  updated_at: string;
  /** Stability evidence that justified quarantine (flip counts). */
  evidence: {
    reruns: number;
    passes: number;
    failures: number;
  };
  /** Suspected root-cause smells surfaced for fixing. */
  suspected_causes: FlakinessSmell[];
  /** Module slugs this test belongs to (for the forced-fix-on-touch link). */
  modules: string[];
  /** Why the quarantine was cleared, when `status` is `cleared`. */
  cleared_reason?: string;
}

/** The persisted registry document at `.paqad/flaky-tests/registry.json`. */
export interface FlakyRegistry {
  schema_version: typeof FLAKY_REGISTRY_SCHEMA_VERSION;
  updated_at: string;
  entries: FlakyRegistryEntry[];
}

/**
 * A verification-evidence failure annotated with its quarantine state. A
 * quarantined failure no longer blocks; a non-quarantined failure is real.
 */
export interface AnnotatedFailure extends VerificationEvidenceFailure {
  quarantined: boolean;
  flaky: boolean;
}

/**
 * The result of applying the quarantine registry over a verification result. The
 * green is "meaningful" only when no quarantined test sat in the would-be-green
 * set — a pass that rode on a quarantined test is not real comfort.
 */
export interface QuarantineApplication {
  /** Failures that still block the gate (not quarantined). */
  blocking: AnnotatedFailure[];
  /** Failures suppressed by an active quarantine (tracked, not deleted). */
  quarantined: AnnotatedFailure[];
  /** test_ids of active quarantines that affected this result. */
  active_quarantines: string[];
  /**
   * Whether a green outcome here is meaningful. False when any quarantined test
   * exists for the suite under check — protection is set aside, so green cannot
   * be fully trusted (the issue's "stops giving false comfort").
   */
  meaningful_green: boolean;
}

/** A quarantined test owed by a touched module, surfaced by the touch gate. */
export interface QuarantineDebt {
  test_id: string;
  suite: string | null;
  module: string;
  suspected_causes: FlakinessSmell[];
}

/** Lanes the forced-fix-on-touch gate applies to (cheap detection runs on all). */
export const FORCED_FIX_LANES = ['graduated', 'full'] as const;
export type ForcedFixLane = (typeof FORCED_FIX_LANES)[number];

/** Result of the module-touch gate over a set of changed files. */
export interface TouchGateResult {
  /** Whether the gate forces fixes before the change can pass. */
  blocked: boolean;
  /** Modules the change touched that own quarantined tests. */
  touched_modules: string[];
  /** The quarantined tests the change must now fix. */
  debts: QuarantineDebt[];
  /** Why the gate did not block, when `blocked` is false. */
  reason: 'fast-lane-skipped' | 'no-debt' | 'forced-fix';
}

/** Per-module quarantine count, rolled up reusing module-map attribution. */
export interface ModuleQuarantineCount {
  module: string;
  quarantined: number;
}

export type { TestIssueSnapshot };
