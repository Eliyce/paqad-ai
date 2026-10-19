// Quality-ratchet verification gate. Issue #110.
//
// Reads the ratchet result the verification phase plants on the context and
// turns it into a pass / fail outcome through the existing verification evidence
// — no parallel store. The rule it enforces: a change is allowed only if every
// measure is equal or better than the recorded level. A worsening blocks until
// it no longer does, unless a `quality.ratchet_exception` was approved for that
// kind (in which case the runner has already marked it excepted, not blocking).
//
// Issue #639, Part 10 — the detail names the measures the ratchet took and the
// ones it could not take, and says "strictness only" on the fast lane, where the
// collector takes nothing else. A run that took no measure at all (no result,
// a skipped run, or every measure blocked) reads DID NOT RUN, never a pass. It
// still never blocks on absence: did not run keeps `passed: true`.

import type { QualityRatchetResult } from '@/core/types/quality-ratchet.js';

import type { Gate } from './gate.interface.js';
import { createDidNotRun, createFail, createPass } from './shared.js';

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

/** A measure id in plain words: `dead_code` reads "dead code". */
function measureWords(measure: string): string {
  return measure.replace(/_/g, ' ');
}

/** The measures that produced a value this run, and the ones that could not be taken. */
export function ratchetMeasureScope(result: QualityRatchetResult): {
  taken: string[];
  blocked: string[];
} {
  const taken = new Set<string>();
  const blocked = new Set<string>();
  for (const verdict of result.verdicts) {
    const words = measureWords(verdict.measure);
    if (verdict.outcome === 'blocked' || verdict.current_value === null) blocked.add(words);
    else taken.add(words);
  }
  return { taken: [...taken], blocked: [...blocked] };
}

/** The scope note every taken-measure detail ends with. */
function scopeNote(result: QualityRatchetResult, scope: { taken: string[]; blocked: string[] }) {
  const blocked = scope.blocked.length > 0 ? `; blocked: ${scope.blocked.join(', ')}` : '';
  if (result.lane === 'fast') return ` (fast lane, strictness only${blocked})`;
  return ` (measured: ${scope.taken.join(', ')}${blocked})`;
}

export class QualityRatchetGate implements Gate {
  readonly gate = 'quality-ratchet' as const;

  async check(context: Parameters<Gate['check']>[0]) {
    const result = context.quality_ratchet_result;

    if (!result) {
      return createDidNotRun(
        this.gate,
        'Quality ratchet did not run, so no quality measure was compared.',
      );
    }

    if (result.status === 'skipped') {
      return createDidNotRun(
        this.gate,
        `Quality ratchet did not run (${result.skipped_reason ?? 'no measures to evaluate'}).`,
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

    const scope = ratchetMeasureScope(result);
    if (scope.taken.length === 0) {
      const blocked = scope.blocked.length > 0 ? ` (blocked: ${scope.blocked.join(', ')})` : '';
      return createDidNotRun(
        this.gate,
        `Quality ratchet did not run: no quality measure could be taken${blocked}.`,
        'Wire the tool each blocked measure reads (for example a tsconfig for strictness) so the ratchet can compare it.',
      );
    }

    if (result.status === 'captured') {
      return createPass(
        this.gate,
        `Quality baseline captured at today's level${scopeNote(result, scope)}; nothing to compare yet.`,
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
      `Every quality measure held equal or better${scopeNote(result, scope)}${tightened}${excepted}.`,
    );
  }
}
