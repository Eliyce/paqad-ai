import { PAQAD_VERDICT } from '@/core/constants/paqad-voice.js';
import { currentFeature } from '@/feature-evidence/stage-ledger.js';
import { resolveSessionId } from '@/rag-ledger/session.js';
import type { RepositoryVerificationVerdict } from '@/verification/repository/verdict.js';
import {
  verdictKindFor,
  verdictParts,
  type VerdictKind,
  type VerdictParts,
} from '@/verification/verdict-kind.js';

import { hudReceiptPath, hudVerdictPath, writeFileAtomic } from './files.js';

export interface HudVerdictRecord {
  schema: 'paqad.hud-verdict/1';
  session_id: string;
  change: string | null;
  word: string;
  kind: VerdictKind;
  passed: boolean;
  reasons: string[];
  work_kind?: VerdictKind;
  work_reasons?: string[];
  record_gaps?: string[];
  written_at: string;
}

export interface WrittenHudReceipt {
  receiptPath: string;
  verdictPath: string;
  verdict: HudVerdictRecord;
}

export function writeHudReceipt(
  projectRoot: string,
  hostSessionId: string | null,
  verdict: Pick<
    RepositoryVerificationVerdict,
    'gates' | 'summary' | 'receipt' | 'kind' | 'applicable' | 'change'
  > &
    Partial<VerdictParts>,
  now: () => Date = () => new Date(),
): WrittenHudReceipt | null {
  if (verdict.applicable === false || (verdict.kind === undefined && verdict.gates.length === 0)) {
    return null;
  }
  const sessionId = resolveSessionId(projectRoot, hostSessionId);
  const kind = verdict.kind ?? verdictKindFor(verdict.gates);
  const record: HudVerdictRecord = {
    schema: 'paqad.hud-verdict/1',
    session_id: sessionId,
    change: verdict.change !== undefined ? verdict.change : activeChange(projectRoot, sessionId),
    word: PAQAD_VERDICT[kind],
    kind,
    passed: kind === 'pass',
    reasons: verdict.gates
      .filter((gate) => gate.status === 'fail' || gate.status === 'inconclusive')
      .sort((a, b) => (a.status === b.status ? 0 : a.status === 'fail' ? -1 : 1))
      .map((gate) => `${gate.gate}: ${gate.detail}`),
    ...recordParts(verdict),
    written_at: now().toISOString(),
  };
  const receiptPath = hudReceiptPath(projectRoot, sessionId);
  const verdictPath = hudVerdictPath(projectRoot, sessionId);
  writeFileAtomic(receiptPath, `${verdict.receipt ?? verdict.summary}\n`);
  writeFileAtomic(verdictPath, `${JSON.stringify(record, null, 2)}\n`);
  return { receiptPath, verdictPath, verdict: record };
}

function recordParts(
  verdict: Pick<RepositoryVerificationVerdict, 'gates'> & Partial<VerdictParts>,
): Pick<HudVerdictRecord, 'work_kind' | 'work_reasons' | 'record_gaps'> {
  const parts =
    verdict.work_kind !== undefined
      ? verdict
      : verdict.gates.length > 0
        ? verdictParts(verdict.gates)
        : null;
  if (!parts?.work_kind) return {};
  return {
    work_kind: parts.work_kind,
    work_reasons: parts.work_reasons ?? [],
    record_gaps: (parts.record_gaps ?? []).map((gap) => gap.text),
  };
}

function activeChange(projectRoot: string, sessionId: string): string | null {
  try {
    return currentFeature(projectRoot, sessionId);
  } catch {
    return null;
  }
}
