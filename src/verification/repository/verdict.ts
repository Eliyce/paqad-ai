// Issue #117 (C-6) — the trust verdict. One machine-readable, per-gate verdict
// the developer can rely on instead of re-reading the diff: "spec reviewed, 0
// drift, 5/5 ACs mapped, ratchet held, docs fresh", or the precise list of
// failures. Derived from the verification-evidence artifact so the hook, the
// CI backstop, and the desktop event stream all report the same shape.

import { PAQAD_STATUS_GLYPH, PAQAD_VERDICT, paqadFrameLead } from '@/core/constants/paqad-voice.js';
import type { GateSkipKind, VerificationGate, WaitingDecision } from '@/core/types/verification.js';
import { verdictKindFor, type VerdictKind } from '@/verification/verdict-kind.js';
import type {
  EvidenceGateStatus,
  VerificationEvidence,
} from '@/core/types/verification-evidence.js';

export interface RepositoryVerificationGateVerdict {
  gate: VerificationGate;
  status: EvidenceGateStatus;
  detail: string;
  remediation: string | null;
  /** Issue #579 — the short skip reason, carried from the evidence gate when present. */
  skip_reason?: string;
  /** Issue #639, Part 10 — on a skipped gate, not required or did not run. */
  skip_kind?: GateSkipKind;
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
  /**
   * The verdict kind from the one verdict rule (issue #639, Part 4), set by the repository
   * verification once the stage gaps are known. Every surface that prints a word reads it.
   */
  kind?: VerdictKind;
  /**
   * Set to `false` ONLY by the hook-completion skip (issue #669): this session's turn was not
   * checked (it owns no change, or it was a detour that edited nothing). A skip has no gates and
   * no kind, so it must never be read as a pass; the HUD keeps the last real verdict instead.
   */
  applicable?: false;
  /** The model-facing narration advisory (issue #409): set when this change recorded
   *  stages the agent never spoke in visible text, empty otherwise. Advisory by
   *  contract — it never contributes to `ok`, because a silent turn is a voice defect,
   *  not a broken change. */
  narrationAdvisory?: string;
  /** Per-gate pass/fail/inconclusive/skipped with specifics. */
  gates: RepositoryVerificationGateVerdict[];
  /** Signals that could not be proven either way and escalate without blocking
   *  (e.g. "spec-review: no frozen spec on record"). */
  escalations: string[];
  /** Project path the evidence JSON was written to, or null if the write was
   *  skipped/failed. */
  evidence_path: string | null;
  /** Absolute path to the rendered per-feature `report.html` (issue #371), or null when
   *  no feature was active, the flag is off, or rendering failed. Best-effort — its
   *  absence never affects `ok`. */
  reportPath?: string | null;
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
  /** Issue #579 — gates whose feature flag is on; a skip among them prints a skip line. */
  flagOnGates?: readonly VerificationGate[];
  waitingDecisions?: readonly WaitingDecision[];
}): RepositoryVerificationVerdict {
  const gates: RepositoryVerificationGateVerdict[] = input.evidence.gates.map((gate) => ({
    gate: gate.name,
    status: gate.status,
    detail: gate.detail,
    remediation: gate.remediation,
    ...(gate.skip_reason !== undefined ? { skip_reason: gate.skip_reason } : {}),
    ...(gate.skip_kind !== undefined ? { skip_kind: gate.skip_kind } : {}),
  }));

  const failing = gates.filter((gate) => gate.status === 'fail');
  const inconclusive = gates.filter((gate) => gate.status === 'inconclusive');
  const ok = failing.length === 0 && inconclusive.length === 0;

  return {
    origin: input.origin,
    ok,
    summary: formatVerdictSummary({
      ok,
      gates,
      escalations: input.escalations,
      ...(input.flagOnGates ? { flagOnGates: input.flagOnGates } : {}),
      ...(input.waitingDecisions ? { waitingDecisions: input.waitingDecisions } : {}),
    }),
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
 *
 * `unrecordedMandatoryStages` (issue #472) reconciles the headline with the per-stage
 * block: when the GATES all passed but a mandatory feature-development stage has no
 * evidence, "Safe to merge" over-claims relative to the stage block (which shows the
 * stage 🟡/🔴). In that case the word is downgraded to Inconclusive — the contract's
 * over-trust guard — while the true "N/N checks held" line is kept so the gates that
 * held are still credited. It never affects the caller's `ok` (exit/block) signal.
 */
export function formatVerdictSummary(input: {
  ok: boolean;
  gates: RepositoryVerificationGateVerdict[];
  escalations: string[];
  unrecordedMandatoryStages?: string[];
  /**
   * Issue #579 — gates whose feature flag is on. A not-required gate in this list adds one
   * "⚪ <gate words>: not required (<reason>)" line after the status lines and before the
   * escalations, so a flag-on gate that did nothing is visible. Skips never move the counts.
   */
  flagOnGates?: readonly VerificationGate[];
  waitingDecisions?: readonly WaitingDecision[];
}): string {
  // Issue #639, Part 10 — the counts are the required gates that ran: a skipped gate, not
  // required or did not run, drops out of both numbers.
  const ran = input.gates.filter((gate) => gate.status !== 'skipped');
  const passed = ran.filter((gate) => gate.status === 'pass').length;
  const failing = ran.filter((gate) => gate.status === 'fail');
  const inconclusive = ran.filter((gate) => gate.status === 'inconclusive');
  const stageGaps = input.unrecordedMandatoryStages ?? [];

  const lines: string[] = [];
  // Issue #639, Part 4 — the word comes from the one verdict rule every surface shares.
  const kind = verdictKindFor(input.gates, stageGaps);

  if (kind === 'pass') {
    lines.push(paqadFrameLead(PAQAD_VERDICT.pass));
    lines.push(`> ${PAQAD_STATUS_GLYPH.good} ${passed}/${ran.length} checks held for you.`);
  } else if (kind === 'inconclusive' && inconclusive.length === 0) {
    // Issue #472 — gates passed, but mandatory feature-development stages have no evidence.
    // The gate headline over-claims relative to the stage block, so read Inconclusive (the
    // over-trust guard) while still crediting the gates that held.
    lines.push(paqadFrameLead(PAQAD_VERDICT.inconclusive));
    lines.push(`> ${PAQAD_STATUS_GLYPH.good} ${passed}/${ran.length} checks held for you.`);
    lines.push(
      `> ${PAQAD_STATUS_GLYPH.needsLook} needs a look — mandatory stage(s) not recorded: ` +
        `${stageGaps.join(', ')}. Mark them so the change is provably complete.`,
    );
  } else if (kind === 'fail') {
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

  lines.push(...skipLines(input.gates, new Set(input.flagOnGates ?? [])));
  lines.push(...waitingDecisionLines(input.waitingDecisions ?? []));

  for (const escalation of input.escalations) {
    lines.push(`> ${PAQAD_STATUS_GLYPH.needsLook} needs a look — ${escalation}`);
  }

  return lines.join('\n');
}

/** A gate id in plain words: `visual-evidence` reads "visual evidence". */
function gateWords(gate: string): string {
  return gate.split('-').join(' ');
}

/**
 * Issue #639, Part 10 — the honest lines for gates that measured nothing. Every did-not-run
 * gate is shown, grouped by reason so the gates the run never checks read as one line
 * ("⚪ story quality, spec review: did not run (not checked in this run)"). A not-required gate
 * is shown only when its feature flag is on (issue #579), so a change is not buried in lines
 * about gates it never needed. A skipped gate written before Part 10 carries no kind and reads
 * as not required. A did-not-run gate with no short reason shows its own detail, which already
 * says it did not run ("Mutation testing did not run: ...").
 */
function waitingDecisionLines(waiting: readonly WaitingDecision[]): string[] {
  return waiting.map(
    (packet) =>
      `> ${PAQAD_STATUS_GLYPH.skipped} a decision is waiting for you: ${packet.decision_id} (${packet.category}): ${packet.question}`,
  );
}

function skipLines(
  gates: readonly RepositoryVerificationGateVerdict[],
  flagOn: ReadonlySet<VerificationGate>,
): string[] {
  const glyph = PAQAD_STATUS_GLYPH.skipped;
  const lines: string[] = [];
  const grouped = new Map<string, string[]>();
  for (const gate of gates) {
    if (gate.status !== 'skipped') continue;
    const words = gateWords(gate.gate);
    if (gate.skip_kind === 'did-not-run') {
      const reason = gate.skip_reason;
      if (reason === undefined) lines.push(`> ${glyph} ${words}: ${gate.detail}`);
      else grouped.set(reason, [...(grouped.get(reason) ?? []), words]);
    } else if (flagOn.has(gate.gate)) {
      lines.push(`> ${glyph} ${words}: not required (${gate.skip_reason ?? gate.detail})`);
    }
  }
  for (const [reason, names] of grouped) {
    lines.push(`> ${glyph} ${names.join(', ')}: did not run (${reason})`);
  }
  return lines;
}
