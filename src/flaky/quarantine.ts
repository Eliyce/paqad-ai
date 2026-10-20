import type { AnnotatedFailure, FlakyRegistry, QuarantineApplication } from '@/core/types/flaky.js';
import type { VerificationEvidenceFailure } from '@/core/types/verification-evidence.js';

import { activeQuarantines, entryKey } from './registry.js';

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

  const meaningful_green = quarantinedKeys.size === 0;

  return {
    blocking,
    quarantined,
    active_quarantines: [...applied].sort(),
    meaningful_green,
  };
}

export function passesBlockingGate(application: QuarantineApplication): boolean {
  return application.blocking.length === 0;
}
