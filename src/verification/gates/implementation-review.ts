import {
  collectMachineFindings,
  findingAnchor,
  unanchoredMachineFindings,
} from '@/review-digest/index.js';
import { readFeatureReview } from '@/feature-evidence/artifacts.js';
import { currentFeature } from '@/feature-evidence/stage-ledger.js';
import { resolveSessionId } from '@/rag-ledger/session.js';

import type { Gate } from './gate.interface.js';

import {
  checkBooleanGate,
  createDidNotRun,
  createFail,
  createNotRequired,
  createPass,
} from './shared.js';

function activeReview(projectRoot: string): ReturnType<typeof readFeatureReview> {
  try {
    const sessionId = resolveSessionId(projectRoot, process.env.CLAUDE_SESSION_ID ?? null);
    const dirName = currentFeature(projectRoot, sessionId);
    return dirName ? readFeatureReview(projectRoot, dirName) : null;
    /* v8 ignore start -- defensive: an unreadable ledger must never crash a gate */
  } catch {
    return null;
  }
  /* v8 ignore stop */
}

function reviewText(review: ReturnType<typeof readFeatureReview>): string {
  if (!review) return '';
  return [
    review.summary,
    review.rollback,
    ...(review.checked ?? []),
    ...(review.findings ?? []).flatMap((finding) => [finding.description, finding.file ?? '']),
  ].join('\n');
}

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

    const review = activeReview(context.project_root);
    const unaddressed = unanchoredMachineFindings(
      collectMachineFindings(context.project_root),
      reviewText(review),
    );
    if (unaddressed.length > 0) {
      return createFail(
        this.gate,
        `Review does not address ${unaddressed.length} deterministic machine finding(s): ${unaddressed
          .map((finding) => `${findingAnchor(finding)} (${finding.source})`)
          .join('; ')}`,
        'Run `paqad-ai review digest`, then confirm or contest each finding in the review (cite its file:line).',
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

    if (context.implementation_review_passed && !review) {
      return context.lane === 'fast'
        ? createNotRequired(this.gate, 'This lane has no review stage.')
        : createDidNotRun(
            this.gate,
            'No review is on record for this change, so nothing was reviewed.',
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
