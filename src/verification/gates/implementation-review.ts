import {
  collectMachineFindings,
  findingAnchor,
  unanchoredMachineFindings,
} from '@/review-digest/index.js';
import { readFeatureReview } from '@/feature-evidence/artifacts.js';
import { currentFeature } from '@/feature-evidence/stage-ledger.js';
import { resolveSessionId } from '@/rag-ledger/session.js';

import type { Gate } from './gate.interface.js';

import { checkBooleanGate, createFail, createPass } from './shared.js';

/**
 * Every word the recorded review put on the page, as one searchable blob (issue #360).
 * The anchoring check is deliberately blunt — it asks "did the reviewer look at this
 * place?", not "is the prose good" — so it reads every field the model filled, including
 * what it says it checked and how it would roll back. Returns `''` when no review is on
 * record, which correctly reads as "nothing was addressed".
 */
function activeReviewText(projectRoot: string): string {
  try {
    const sessionId = resolveSessionId(projectRoot, process.env.CLAUDE_SESSION_ID ?? null);
    const dirName = currentFeature(projectRoot, sessionId);
    if (!dirName) return '';
    const review = readFeatureReview(projectRoot, dirName);
    if (!review) return '';
    return [
      review.summary,
      review.rollback,
      ...(review.checked ?? []),
      ...(review.findings ?? []).flatMap((finding) => [finding.description, finding.file ?? '']),
    ].join('\n');
    /* v8 ignore next 3 -- defensive: an unreadable ledger must never crash a gate */
  } catch {
    return '';
  }
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

    // Issue #360 — the review must confirm or contest what the machine already proved.
    // An unaddressed deterministic finding is itself a review finding: a review that never
    // mentions a high-severity machine finding by file:line did not review the change, it
    // reviewed its own impression of it. Only deterministic, file-anchored, high-band rows
    // can fire this (INV-2), so a change with no machine findings behaves exactly as
    // before (AC-3).
    const unaddressed = unanchoredMachineFindings(
      collectMachineFindings(context.project_root),
      activeReviewText(context.project_root),
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

    return checkBooleanGate(
      this.gate,
      context.implementation_review_passed,
      'Implementation review passed',
      'Implementation review failed',
      'Resolve implementation review findings before continuing.',
    );
  }
}
