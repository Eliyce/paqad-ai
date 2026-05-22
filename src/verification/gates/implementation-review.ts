import type { Gate } from './gate.interface.js';

import { checkBooleanGate, createFail, createPass } from './shared.js';

export class ImplementationReviewGate implements Gate {
  readonly gate = 'implementation-review' as const;

  async check(context: Parameters<Gate['check']>[0]) {
    const findings = context.implementation_review_findings ?? [];
    const blocking = findings.filter((finding) => finding.severity === 'error');
    if (blocking.length > 0) {
      return createFail(
        this.gate,
        `Implementation review found blocking defects: ${blocking
          .map((finding) => finding.detail)
          .join('; ')}`,
        'Resolve implementation review findings before continuing.',
      );
    }

    const warnings = findings.filter((finding) => finding.severity === 'warning');
    if (warnings.length > 0) {
      return createPass(
        this.gate,
        `Implementation review passed with warnings: ${warnings
          .map((finding) => finding.detail)
          .join('; ')}`,
      );
    }

    return checkBooleanGate(
      this.gate,
      context.implementation_review_passed,
      'Implementation review passed',
      'Implementation review failed',
      'Resolve implementation review findings before continuing.',
    );
  }
}
