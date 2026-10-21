import { PAQAD_VERDICT } from '@/core/constants/paqad-voice.js';
import { currentFeature } from '@/feature-evidence/stage-ledger.js';
import { resolveSessionId } from '@/rag-ledger/session.js';
import type { RepositoryVerificationVerdict } from '@/verification/repository/verdict.js';
import { verdictKindFor, type VerdictKind } from '@/verification/verdict-kind.js';

import { hudReceiptPath, hudVerdictPath, writeFileAtomic } from './files.js';

export interface HudVerdictRecord {
  schema: 'paqad.hud-verdict/1';
  session_id: string;
  change: string | null;
  word: string;
  kind: VerdictKind;
  passed: boolean;
  reasons: string[];
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
    'gates' | 'summary' | 'receipt' | 'kind' | 'applicable'
  >,
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
    change: activeChange(projectRoot, sessionId),
    word: PAQAD_VERDICT[kind],
    kind,
    passed: kind === 'pass',
    reasons: verdict.gates
      .filter((gate) => gate.status === 'fail' || gate.status === 'inconclusive')
      .sort((a, b) => (a.status === b.status ? 0 : a.status === 'fail' ? -1 : 1))
      .map((gate) => `${gate.gate}: ${gate.detail}`),
    written_at: now().toISOString(),
  };
  const receiptPath = hudReceiptPath(projectRoot, sessionId);
  const verdictPath = hudVerdictPath(projectRoot, sessionId);
  writeFileAtomic(receiptPath, `${verdict.receipt ?? verdict.summary}\n`);
  writeFileAtomic(verdictPath, `${JSON.stringify(record, null, 2)}\n`);
  return { receiptPath, verdictPath, verdict: record };
}

function activeChange(projectRoot: string, sessionId: string): string | null {
  try {
    return currentFeature(projectRoot, sessionId);
  } catch {
    return null;
  }
}
