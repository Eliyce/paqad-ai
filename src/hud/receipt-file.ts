// Keep paqad's own receipt every turn (issue #639, Part 6).
//
// The in-session Stop hook computes the full end-of-change receipt and then throws it away: it
// prints nothing on a clean or Inconclusive turn, and only a model-facing `{decision:'block'}`
// reason on a hard failure. The HUD (and `/paqad receipt`) needs the receipt paqad itself
// computed, not the model's retelling of it, so the backstop now writes it to the session's
// HUD files. It prints nothing new and changes no decision.

import { PAQAD_VERDICT } from '@/core/constants/paqad-voice.js';
import { resolveSessionId } from '@/rag-ledger/session.js';
import type { RepositoryVerificationVerdict } from '@/verification/repository/verdict.js';
import { verdictKindFor, type VerdictKind } from '@/verification/verdict-kind.js';

import { hudReceiptPath, hudVerdictPath, writeFileAtomic } from './files.js';

/** The verdict half of the in-session receipt, as the snapshot reads it. */
export interface HudVerdictRecord {
  schema: 'paqad.hud-verdict/1';
  session_id: string;
  /** The contract word: Safe to merge / Needs your attention / Inconclusive. */
  word: string;
  kind: VerdictKind;
  /** True only for Safe to merge. */
  passed: boolean;
  /** One line per failing or inconclusive gate, in the order the verdict lists them. */
  reasons: string[];
  written_at: string;
}

export interface WrittenHudReceipt {
  receiptPath: string;
  verdictPath: string;
  verdict: HudVerdictRecord;
}

/**
 * Write the composed receipt (the exact text the git and CI backstop prints) and the verdict
 * record for `hostSessionId`. Throws on a write failure; the backstop catches and logs it.
 *
 * Issue #669 — returns null and writes nothing for a turn that was not checked: a skip verdict
 * (`applicable: false`), or any verdict with no gates and no decided kind, which would otherwise
 * derive to Safe to merge. The previous HUD files stay as they were, so the last real verdict
 * stays on screen.
 */
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
