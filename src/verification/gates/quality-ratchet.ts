// Quality-ratchet verification gate. Issue #110.
//
// Reads the ratchet result the verification phase plants on the context and
// turns it into a pass / fail outcome through the existing verification evidence
// — no parallel store. The rule it enforces: a change is allowed only if every
// measure is equal or better than the recorded level. A worsening blocks until
// it no longer does, unless a `quality.ratchet_exception` was approved for that
// kind (in which case the runner has already marked it excepted, not blocking).
//
// The gate is inert when there is no signal (no baseline yet, fast lane with
// nothing comparable, no result wired) so it never blocks on absence.

import type { QualityRatchetResult } from '@/core/types/quality-ratchet.js';

import type { Gate } from './gate.interface.js';
import { createFail, createPass } from './shared.js';

function summarizeRegressions(result: QualityRatchetResult): string {
  const shown = result.blocking_regressions
    .slice(0, 5)
    .map((r) => `${r.measure}@${r.module} ${r.baseline_value ?? 'n/a'}→${r.current_value ?? 'n/a'}`)
    .join(', ');
  const extra =
    result.blocking_regressions.length > 5
      ? `, +${result.blocking_regressions.length - 5} more`
      : '';
  return `${shown}${extra}`;
}

export class QualityRatchetGate implements Gate {
  readonly gate = 'quality-ratchet' as const;

  async check(context: Parameters<Gate['check']>[0]) {
    const result = context.quality_ratchet_result;

    if (!result) {
      return createPass(this.gate, 'Quality ratchet did not run; no signal to evaluate.');
    }

    if (result.status === 'skipped') {
      return createPass(
        this.gate,
        `Quality ratchet skipped (${result.skipped_reason ?? 'no measures to evaluate'}).`,
      );
    }

    if (result.status === 'captured') {
      return createPass(
        this.gate,
        `Quality baseline captured at today's level (${result.verdicts.length} measure(s)); nothing to compare yet.`,
      );
    }

    if (result.status === 'regressed') {
      const excepted =
        result.excepted_regressions.length > 0
          ? ` (${result.excepted_regressions.length} approved exception(s) allowed)`
          : '';
      return createFail(
        this.gate,
        `${result.blocking_regressions.length} quality measure(s) worsened against the baseline${excepted}: ${summarizeRegressions(result)}.`,
        'Bring each measure back to at least its recorded level, or open a quality.ratchet_exception pause to approve a legitimate regression.',
      );
    }

    const tightened =
      result.tightened.length > 0 ? `; ${result.tightened.length} measure(s) tightened` : '';
    const excepted =
      result.excepted_regressions.length > 0
        ? `; ${result.excepted_regressions.length} approved exception(s)`
        : '';
    return createPass(
      this.gate,
      `Every quality measure held equal or better${tightened}${excepted}.`,
    );
  }
}
