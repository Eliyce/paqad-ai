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
  skip_reason?: string;
  skip_kind?: GateSkipKind;
}

export interface RepositoryVerificationVerdict {
  origin: string;
  ok: boolean;
  summary: string;
  receipt?: string;
  kind?: VerdictKind;
  applicable?: false;
  narrationAdvisory?: string;
  change?: string | null;
  gates: RepositoryVerificationGateVerdict[];
  escalations: string[];
  evidence_path: string | null;
  reportPath?: string | null;
  started_at: string;
  completed_at: string;
}

export function buildRepositoryVerificationVerdict(input: {
  origin: string;
  evidence: VerificationEvidence;
  escalations: string[];
  evidencePath: string | null;
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

export function formatVerdictSummary(input: {
  ok: boolean;
  gates: RepositoryVerificationGateVerdict[];
  escalations: string[];
  unrecordedMandatoryStages?: string[];
  flagOnGates?: readonly VerificationGate[];
  waitingDecisions?: readonly WaitingDecision[];
}): string {
  const ran = input.gates.filter((gate) => gate.status !== 'skipped');
  const passed = ran.filter((gate) => gate.status === 'pass').length;
  const failing = ran.filter((gate) => gate.status === 'fail');
  const inconclusive = ran.filter((gate) => gate.status === 'inconclusive');
  const stageGaps = input.unrecordedMandatoryStages ?? [];

  const lines: string[] = [];
  const kind = verdictKindFor(input.gates, stageGaps);

  if (kind === 'pass') {
    lines.push(paqadFrameLead(PAQAD_VERDICT.pass));
    lines.push(`> ${PAQAD_STATUS_GLYPH.good} ${passed}/${ran.length} checks held for you.`);
  } else if (kind === 'inconclusive' && inconclusive.length === 0) {
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

function gateWords(gate: string): string {
  return gate.split('-').join(' ');
}

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
