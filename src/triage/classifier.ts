import type { Lane } from '@/core/types/routing.js';
import type { TriageFinding, TriageVerdict } from '@/core/types/triage.js';

// Issue #107 — the four-pile classifier. Rules first (cheap, deterministic),
// the human only for the residue (open decision #1, taking the recommendation).
// The honesty rule: only the `confirmed` pile, and only when *demonstrable*,
// may drive a code change — every edit to working code is a fresh chance to
// introduce a real defect, so taste / false-alarm / unclear-spec / not-yet-
// reproducible findings never touch code.

/**
 * Sorts one finding into exactly one of the four piles using its deterministic
 * signals, or marks it ambiguous (pile `null`, route `ask-human`) when the
 * rules cannot decide. A measurable quality regression is not a taste call — it
 * is routed to the ratchet (#110) with pile `null` (open decision #3).
 *
 * Order matters: the strongest, most specific signals are checked first.
 */
export function classifyFinding(finding: TriageFinding): TriageVerdict {
  const s = finding.signals;
  const base = { finding_id: finding.id, ambiguous: false } as const;

  // A misread — contradicted by evidence (e.g. the cited location does not
  // exist). Set aside with a reason; never silently dropped.
  if (s.refuted_by_evidence) {
    return {
      ...base,
      pile: 'false-alarm',
      route: 'record',
      reason: 'Contradicted by evidence — set aside as a misread.',
    };
  }

  // A measurable strictness/complexity regression belongs to the ratchet (#110),
  // not the taste bin. Triage recognises and hands it off rather than binning it.
  if (s.measurable_quality) {
    return {
      ...base,
      pile: null,
      route: 'ratchet',
      reason: 'Measurable quality regression — handed to the quality ratchet (#110).',
    };
  }

  // "The spec didn't say." This is a spec gap, routed back to the spec (#102),
  // not a code patch.
  if (s.spec_silent) {
    return {
      ...base,
      pile: 'unclear-spec',
      route: 'spec',
      reason: 'The spec did not cover this — routed to the spec (#102), not patched.',
    };
  }

  // A failing gate is a real problem. "Confirmed" must mean demonstrable: with a
  // reproducing proof it can drive a change (→ #103); without one it waits in the
  // needs-repro sub-state and must NOT drive a change yet (open decision #2).
  if (s.gate_failed) {
    if (s.reproducible) {
      return {
        ...base,
        pile: 'confirmed',
        confirmation: 'demonstrable',
        route: 'code-change',
        reason:
          'Failing gate with reproducing evidence — confirmed; proceed via the prove-it protocol (#103).',
      };
    }
    return {
      ...base,
      pile: 'confirmed',
      confirmation: 'needs-repro',
      route: 'await-repro',
      reason:
        'Failing gate without a reproducing proof yet — confirmed-pending-repro; waits, does not drive a change.',
    };
  }

  // Style/format only with no behavioural effect — a different-but-fine way to
  // write it. Recorded, not acted on.
  if (s.style_only && !s.behavioural) {
    return {
      ...base,
      pile: 'taste',
      route: 'record',
      reason: 'Style-only with no behavioural effect — a matter of taste, recorded not acted on.',
    };
  }

  // Nothing decisive — genuinely ambiguous. Put to the human via a
  // `finding.triage` Decision Pause (unless the fast lane downgrades it).
  return {
    ...base,
    pile: null,
    ambiguous: true,
    route: 'ask-human',
    reason: 'No decisive signal — ambiguous; open a finding.triage Decision Pause.',
  };
}

/**
 * Triages a finding for a given lane. Triage adds no heavy ceremony to small,
 * low-risk work: on the `fast` lane it is a cheap automatic pass with no human
 * prompts — an ambiguous finding is set aside (recorded) rather than asked, so
 * it never blocks and never churns code on uncertainty. Human escalation only
 * happens on genuine ambiguity, and only off the `fast` lane.
 */
export function triageFinding(finding: TriageFinding, lane: Lane): TriageVerdict {
  const verdict = classifyFinding(finding);
  if (verdict.route === 'ask-human' && lane === 'fast') {
    return {
      finding_id: finding.id,
      pile: null,
      ambiguous: false,
      route: 'record',
      reason: 'fast lane: ambiguous finding set aside automatically without a prompt.',
    };
  }
  return verdict;
}

/**
 * The single gate the whole feature exists to enforce: only a confirmed,
 * *demonstrable* finding may drive a code change. Everything else — taste,
 * false-alarm, unclear-spec, ratchet, ambiguous, and confirmed-but-needs-repro —
 * returns false.
 */
export function canDriveCodeChange(verdict: TriageVerdict): boolean {
  return verdict.pile === 'confirmed' && verdict.confirmation === 'demonstrable';
}

/** The subset of verdicts that may drive a code change. */
export function changeDrivingVerdicts(verdicts: TriageVerdict[]): TriageVerdict[] {
  return verdicts.filter(canDriveCodeChange);
}
