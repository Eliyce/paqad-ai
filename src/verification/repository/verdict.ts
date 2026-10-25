import { PAQAD_STATUS_GLYPH, PAQAD_VERDICT, paqadFrameLead } from '@/core/constants/paqad-voice.js';
import {
  gateOwner,
  recordGapText,
  type GateSkipKind,
  type VerificationGate,
  type WaitingDecision,
} from '@/core/types/verification.js';
import { GATE_STATE_LABEL, type GateState } from '@/evidence/grading.js';
import {
  unrecordedStagesGap,
  verdictKindFor,
  type RecordGap,
  type VerdictKind,
} from '@/verification/verdict-kind.js';
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
  could_not_prove?: true;
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
  work_kind?: VerdictKind;
  work_reasons?: string[];
  record_gaps?: RecordGap[];
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
    ...(gate.could_not_prove ? { could_not_prove: true as const } : {}),
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
  const passed = ran.filter((gate) => gate.status === 'pass' && !gate.could_not_prove).length;
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
    lines.push(`> ${PAQAD_STATUS_GLYPH.skipped} ${unrecordedStagesGap(stageGaps).text}.`);
  } else if (kind === 'fail') {
    lines.push(paqadFrameLead(PAQAD_VERDICT.fail));
    for (const gate of failing) {
      lines.push(
        isRecordGap(gate)
          ? recordGapLine(gate)
          : `> ${PAQAD_STATUS_GLYPH.failed} ${gate.gate}: ${gate.detail}`,
      );
    }
    lines.push(...inconclusive.map(inconclusiveLine));
  } else {
    lines.push(paqadFrameLead(PAQAD_VERDICT.inconclusive));
    lines.push(...inconclusive.map(inconclusiveLine));
  }

  lines.push(...ran.filter((gate) => gate.could_not_prove).map(inconclusiveLine));
  lines.push(...skipLines(input.gates, new Set(input.flagOnGates ?? [])));
  lines.push(...waitingDecisionLines(input.waitingDecisions ?? []));

  for (const escalation of input.escalations) {
    lines.push(`> ${PAQAD_STATUS_GLYPH.needsLook} needs a look — ${escalation}`);
  }

  return lines.join('\n');
}

export function receiptGateState(gate: RepositoryVerificationGateVerdict): GateState {
  if (gate.could_not_prove) return 'inconclusive';
  return gate.status === 'skipped' ? (gate.skip_kind ?? 'not-required') : gate.status;
}

export function receiptGateWord(gate: RepositoryVerificationGateVerdict): string {
  return GATE_STATE_LABEL[receiptGateState(gate)];
}

function lowerWord(gate: RepositoryVerificationGateVerdict): string {
  return receiptGateWord(gate).toLowerCase();
}

function labelled(gate: RepositoryVerificationGateVerdict): string {
  const word = lowerWord(gate);
  return gate.detail.toLowerCase().includes(word) ? gate.detail : `${word}. ${gate.detail}`;
}

function isRecordGap(gate: RepositoryVerificationGateVerdict): boolean {
  return gateOwner(gate.gate) === 'paqad-record';
}

function recordGapLine(gate: RepositoryVerificationGateVerdict): string {
  return `> ${PAQAD_STATUS_GLYPH.skipped} ${gate.gate}: ${recordGapText(gate.gate)}. ${gate.detail}`;
}

function inconclusiveLine(gate: RepositoryVerificationGateVerdict): string {
  if (isRecordGap(gate)) return recordGapLine(gate);
  return `> ${PAQAD_STATUS_GLYPH.needsLook} ${gate.gate}: ${labelled(gate)}`;
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
      if (reason === undefined) lines.push(`> ${glyph} ${words}: ${labelled(gate)}`);
      else grouped.set(reason, [...(grouped.get(reason) ?? []), words]);
    } else if (flagOn.has(gate.gate)) {
      lines.push(`> ${glyph} ${words}: ${lowerWord(gate)} (${gate.skip_reason ?? gate.detail})`);
    }
  }
  for (const [reason, names] of grouped) {
    lines.push(`> ${glyph} ${names.join(', ')}: did not run (${reason})`);
  }
  return lines;
}
