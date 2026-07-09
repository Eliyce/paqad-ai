// Issue #117 (C-6) — the trust verdict. One machine-readable, per-gate verdict
// the developer can rely on instead of re-reading the diff: "spec reviewed, 0
// drift, 5/5 ACs mapped, ratchet held, docs fresh", or the precise list of
// failures. Derived from the verification-evidence artifact so the hook, the
// CI backstop, and the desktop event stream all report the same shape.

import { PAQAD_STATUS_GLYPH, PAQAD_VERDICT, paqadFrameLead } from '@/core/constants/paqad-voice.js';
import type { VerificationGate } from '@/core/types/verification.js';
import type {
  EvidenceGateStatus,
  VerificationEvidence,
} from '@/core/types/verification-evidence.js';

export interface RepositoryVerificationGateVerdict {
  gate: VerificationGate;
  status: EvidenceGateStatus;
  detail: string;
  remediation: string | null;
}

export interface RepositoryVerificationVerdict {
  /** The agent-independent origin that fired this run. */
  origin: string;
  /** True iff no gate that ran failed (skipped/inconclusive-but-passed do not
   *  flip this; a hard `fail` does). This is the deterministic "did the agent
   *  obey?" signal. */
  ok: boolean;
  /** One-line trust verdict, the same text the hook prints and the event
   *  stream carries. */
  summary: string;
  /** The full end-of-change receipt (issue #325): the verdict headline + per-stage
   *  evidence + delivery state, composed at the completion seam. Falls back to
   *  `summary` when no stage fold is available. */
  receipt?: string;
  /** Per-gate pass/fail/inconclusive/skipped with specifics. */
  gates: RepositoryVerificationGateVerdict[];
  /** Signals that could not be proven either way and escalate without blocking
   *  (e.g. "spec-review: no frozen spec on record"). */
  escalations: string[];
  /** Project path the evidence JSON was written to, or null if the write was
   *  skipped/failed. */
  evidence_path: string | null;
  started_at: string;
  completed_at: string;
}

/**
 * Build the verdict from the evidence artifact. A run is `ok` when no gate
 * reports a hard `fail`; `skipped` gates (the model-judgment gates the backstop
 * does not re-judge) and inconclusive-but-passed signals never flip it.
 */
export function buildRepositoryVerificationVerdict(input: {
  origin: string;
  evidence: VerificationEvidence;
  escalations: string[];
  evidencePath: string | null;
}): RepositoryVerificationVerdict {
  const gates: RepositoryVerificationGateVerdict[] = input.evidence.gates.map((gate) => ({
    gate: gate.name,
    status: gate.status,
    detail: gate.detail,
    remediation: gate.remediation,
  }));

  const failing = gates.filter((gate) => gate.status === 'fail');
  const inconclusive = gates.filter((gate) => gate.status === 'inconclusive');
  const ok = failing.length === 0 && inconclusive.length === 0;

  return {
    origin: input.origin,
    ok,
    summary: formatVerdictSummary({ ok, gates, escalations: input.escalations }),
    gates,
    escalations: input.escalations,
    evidence_path: input.evidencePath,
    started_at: input.evidence.started_at,
    completed_at: input.evidence.completed_at,
  };
}

/**
 * Render the branded trust verdict in paqad's own vocabulary (issue #325). The
 * headline is one of the contract's three verdict words — never an ad-hoc string —
 * led by the `**▸ paqad** ·` frame, and every status line pairs a fixed glyph with a
 * word so it stays legible with the emoji stripped. On a hard fail it names each
 * failing gate; when only inconclusive signals remain it reads "Inconclusive" (an
 * over-trust guard), and an all-clear reads "Safe to merge".
 *
 * Verdict vocabulary and glyphs come from `paqad-voice.ts`, fulfilling that file's
 * single-source claim so the chat verdict, the PR comment, and the dashboard all say
 * the same words.
 */
export function formatVerdictSummary(input: {
  ok: boolean;
  gates: RepositoryVerificationGateVerdict[];
  escalations: string[];
}): string {
  const ran = input.gates.filter((gate) => gate.status !== 'skipped');
  const passed = ran.filter((gate) => gate.status === 'pass').length;
  const failing = ran.filter((gate) => gate.status === 'fail');
  const inconclusive = ran.filter((gate) => gate.status === 'inconclusive');

  const lines: string[] = [];

  if (input.ok) {
    lines.push(paqadFrameLead(PAQAD_VERDICT.pass));
    lines.push(`> ${PAQAD_STATUS_GLYPH.good} ${passed}/${ran.length} checks held for you.`);
  } else if (failing.length > 0) {
    lines.push(paqadFrameLead(PAQAD_VERDICT.fail));
    for (const gate of [...failing, ...inconclusive]) {
      const glyph =
        gate.status === 'fail' ? PAQAD_STATUS_GLYPH.failed : PAQAD_STATUS_GLYPH.needsLook;
      lines.push(`> ${glyph} ${gate.gate}: ${gate.detail}`);
    }
  } else {
    // No hard failure, but at least one gate could not reach a confident result —
    // report Inconclusive so the developer does not over-trust a green.
    lines.push(paqadFrameLead(PAQAD_VERDICT.inconclusive));
    for (const gate of inconclusive) {
      lines.push(`> ${PAQAD_STATUS_GLYPH.needsLook} ${gate.gate}: ${gate.detail}`);
    }
  }

  for (const escalation of input.escalations) {
    lines.push(`> ${PAQAD_STATUS_GLYPH.needsLook} needs a look — ${escalation}`);
  }

  return lines.join('\n');
}
