import type { AnnotatedFailure, FlakyRegistry, QuarantineApplication } from '@/core/types/flaky.js';
import type { VerificationEvidenceFailure } from '@/core/types/verification-evidence.js';

import { activeQuarantines, entryKey } from './registry.js';

/**
 * Applies the quarantine registry over a verification result's failures.
 *
 * A quarantined test's failure is moved out of the **blocking** set so it stops
 * blocking the gate — but it is annotated, kept in the result, and never
 * silently dropped (issue #106: "never a silent removal of protection"). The
 * remaining failures are still treated as real.
 *
 * Crucially, a green result is only **meaningful** when no active quarantine
 * applies to the suite under check: a pass that rests on a set-aside test gives
 * false comfort, so `meaningful_green` is false whenever an active quarantine is
 * in play. This is what stops a flaky-but-quarantined test from making a check
 * "pass" in a way the agent would trust.
 */
export function applyQuarantine(
  failures: VerificationEvidenceFailure[],
  registry: FlakyRegistry,
): QuarantineApplication {
  const quarantinedKeys = new Set(
    activeQuarantines(registry).map((e) => entryKey(e.test_id, e.suite)),
  );

  const blocking: AnnotatedFailure[] = [];
  const quarantined: AnnotatedFailure[] = [];
  const applied = new Set<string>();

  for (const failure of failures) {
    const key = failure.test_id ? entryKey(failure.test_id, failure.suite) : null;
    const isQuarantined = key !== null && quarantinedKeys.has(key);
    const annotated: AnnotatedFailure = {
      ...failure,
      quarantined: isQuarantined,
      flaky: isQuarantined,
    };
    if (isQuarantined) {
      quarantined.push(annotated);
      /* v8 ignore next 1 -- key is non-null whenever isQuarantined is true */
      if (key) applied.add(key);
    } else {
      blocking.push(annotated);
    }
  }

  // Green is meaningful only when no active quarantine sits over this result —
  // either because none exists, or because none could have masked a failure here.
  const meaningful_green = quarantinedKeys.size === 0;

  return {
    blocking,
    quarantined,
    active_quarantines: [...applied].sort(),
    meaningful_green,
  };
}

/**
 * Whether the gate should pass given a quarantine application. A result passes
 * the *blocking* gate when nothing blocks — but the caller must still treat a
 * non-`meaningful_green` pass as un-trustworthy comfort (surface it; do not wave
 * work through on it).
 */
export function passesBlockingGate(application: QuarantineApplication): boolean {
  return application.blocking.length === 0;
}
