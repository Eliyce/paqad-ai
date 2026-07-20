import type { GateResult, VerificationContext } from '@/core/types/verification.js';
import { readDuplicationReport } from '@/duplication/report.js';
import type { DuplicationFinding } from '@/duplication/types.js';

import type { Gate } from './gate.interface.js';
import { createFail, createPass } from './shared.js';

/**
 * Duplication gate (issue #358) — the Stop-seam half of the "bind it twice" contract. The
 * checks-stage rule-script runs `duplication scan`, which writes the report; this gate reads
 * that cached report so the same near-copy verdict lands in the end-of-change receipt.
 *
 * The gate is INERT (passes) when no report is present — a non-feature-development change never
 * runs the scan, and an inconclusive result would otherwise fail the whole verification. It
 * FAILS only when the report is blocking (strict mode with a deterministic finding); a warn-mode
 * or heuristic-only run passes with the findings surfaced in the detail, so the default two-cycle
 * bake-in never blocks a merge.
 */
export class DuplicationGate implements Gate {
  readonly gate = 'duplication' as const;

  async check(context: VerificationContext): Promise<GateResult> {
    const report = readDuplicationReport(context.project_root);
    if (!report) {
      return createPass(this.gate, 'No duplication report on record; gate inert.');
    }

    const total = report.findings.length;
    if (report.blocking) {
      const lead = firstFindingLead(report.findings);
      return createFail(
        this.gate,
        `${count(report.counts.deterministic, 'near-copy', 'near-copies')} of existing code ` +
          `introduced by this change${lead}.`,
        'Reuse or extend the existing code, or record a create-vs-reuse decision to accept the ' +
          'new copy (the resolved packet unblocks completion).',
      );
    }

    if (total === 0) {
      return createPass(this.gate, 'No new code near-copies existing code.');
    }
    return createPass(
      this.gate,
      `${count(total, 'near-copy', 'near-copies')} flagged (${report.mode} mode, not blocking).`,
    );
  }
}

/** A short ` — <file> near <matched_file>` lead for the first deterministic finding. Only
 *  called on a blocking report, which by construction has at least one deterministic finding. */
function firstFindingLead(findings: DuplicationFinding[]): string {
  const first = findings.find((finding) => finding.kind === 'deterministic');
  /* c8 ignore next -- a blocking report always carries a deterministic finding, so `first` is
     never undefined here; the fallback is defensive only. */
  return first ? ` — ${first.file} near ${first.matched_symbol ?? first.matched_file}` : '';
}

/** Pluralize a count: `1 near-copy`, `2 near-copies`. */
function count(n: number, singular: string, plural: string): string {
  return `${n} ${n === 1 ? singular : plural}`;
}
