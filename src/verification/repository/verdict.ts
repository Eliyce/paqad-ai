// Issue #117 (C-6) — the trust verdict. One machine-readable, per-gate verdict
// the developer can rely on instead of re-reading the diff: "spec reviewed, 0
// drift, 5/5 ACs mapped, ratchet held, docs fresh", or the precise list of
// failures. Derived from the verification-evidence artifact so the hook, the
// CI backstop, and the desktop event stream all report the same shape.

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
 * Render the one-line (plus detail) trust verdict. On pass it states the
 * gate tally and any escalations; on failure it names each failing gate and its
 * detail so the developer reads "what's wrong" without opening the diff.
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
    lines.push(`✓ verification passed — ${passed}/${ran.length} gates held.`);
  } else {
    lines.push(
      `✗ verification blocked — ${failing.length + inconclusive.length}/${ran.length} gates failed.`,
    );
    for (const gate of [...failing, ...inconclusive]) {
      lines.push(`  • ${gate.gate}: ${gate.detail}`);
    }
  }

  for (const escalation of input.escalations) {
    lines.push(`  ⚠ escalate — ${escalation}`);
  }

  return lines.join('\n');
}
