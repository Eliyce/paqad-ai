import type { GateResult, VerificationContext } from '@/core/types/verification.js';
import { readDuplicationReport } from '@/duplication/report.js';
import type { DuplicationFinding } from '@/duplication/types.js';

import type { Gate } from './gate.interface.js';
import { createFail, createNotRequired, createPass } from './shared.js';

export class DuplicationGate implements Gate {
  readonly gate = 'duplication' as const;

  async check(context: VerificationContext): Promise<GateResult> {
    const report = readDuplicationReport(context.project_root);
    if (!report) {
      return createNotRequired(
        this.gate,
        'Not required: no duplication scan ran for this change, so there was nothing to check.',
      );
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

function firstFindingLead(findings: DuplicationFinding[]): string {
  const first = findings.find((finding) => finding.kind === 'deterministic');
  /* c8 ignore next -- a blocking report always carries a deterministic finding, so `first` is
     never undefined here; the fallback is defensive only. */
  return first ? ` — ${first.file} near ${first.matched_symbol ?? first.matched_file}` : '';
}

function count(n: number, singular: string, plural: string): string {
  return `${n} ${n === 1 ? singular : plural}`;
}
