// Fold a session's rag-evidence rows into the rollup `rag-evidence show` reports
// (issue #249 §4). Pure: reads nothing, just aggregates rows. The accuracy dimension
// is deliberately absent — this rollup is occurrence/use-rate only, never a
// proof-of-benefit claim (issue #249 §3).

import { foldByOrdinal, readSessionDoc, type SessionLedgerRow } from '@/session-ledger/ledger.js';

import {
  RAG_EVIDENCE_DOC_TYPE,
  type RagEvidenceConversationFold,
  type RagEvidenceRow,
  type RagEvidenceSessionFold,
  type RagInjectedSection,
} from './types.js';

function avg(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function foldConversation(ordinal: number, rows: RagEvidenceRow[]): RagEvidenceConversationFold {
  const refresh = rows.filter((r) => r.kind === 'refreshed');
  const called = rows.filter((r) => r.kind === 'called');
  const used = rows.filter((r) => r.kind === 'used' && r.injected);
  const fallback = rows.filter((r) => r.kind === 'fallback');
  const latencies = rows.map((r) => r.latency_ms).filter((v): v is number => typeof v === 'number');
  const scores = used.map((r) => r.score_top).filter((v): v is number => typeof v === 'number');
  const sections = new Set<RagInjectedSection>();
  for (const row of used) {
    for (const section of row.injected_sections ?? []) {
      sections.add(section);
    }
  }
  const decided = used.length + fallback.length;
  return {
    conversation_ordinal: ordinal,
    refresh_count: refresh.length,
    called_count: called.length,
    used_count: used.length,
    fallback_count: fallback.length,
    used_rate: decided === 0 ? null : used.length / decided,
    avg_latency_ms: avg(latencies),
    score_top: scores.length === 0 ? null : Math.max(...scores),
    sections_used: [...sections],
  };
}

/** Fold rows (already read) into a session rollup. */
export function foldRagEvidenceRows(
  sessionId: string,
  rows: readonly SessionLedgerRow[],
): RagEvidenceSessionFold {
  const byOrdinal = foldByOrdinal(rows);
  const conversations: RagEvidenceConversationFold[] = [];
  for (const [ordinal, ordinalRows] of byOrdinal) {
    conversations.push(foldConversation(ordinal, ordinalRows as unknown as RagEvidenceRow[]));
  }

  const totals = {
    refresh_count: sum(conversations, (c) => c.refresh_count),
    called_count: sum(conversations, (c) => c.called_count),
    used_count: sum(conversations, (c) => c.used_count),
    fallback_count: sum(conversations, (c) => c.fallback_count),
  };

  const fallbackReasons: Record<string, number> = {};
  for (const row of rows as unknown as RagEvidenceRow[]) {
    if (row.kind === 'fallback' && row.fallback_reason) {
      fallbackReasons[row.fallback_reason] = (fallbackReasons[row.fallback_reason] ?? 0) + 1;
    }
  }
  // A prompt "has RAG" when its conversation injected something; it "fell back" when it
  // recorded a fallback and never injected.
  const promptsWithRag = conversations.filter((c) => c.used_count > 0).length;
  const promptsFallback = conversations.filter(
    (c) => c.used_count === 0 && c.fallback_count > 0,
  ).length;

  return {
    session_id: sessionId,
    conversations,
    totals,
    coverage: {
      prompts_total: conversations.length,
      prompts_with_rag: promptsWithRag,
      prompts_fallback: promptsFallback,
      fallback_reasons: fallbackReasons,
    },
  };
}

/** Read a session's rag-evidence ledger and fold it. */
export function foldRagEvidenceSession(
  projectRoot: string,
  sessionId: string,
): RagEvidenceSessionFold {
  return foldRagEvidenceRows(
    sessionId,
    readSessionDoc(projectRoot, RAG_EVIDENCE_DOC_TYPE, sessionId),
  );
}

function sum<T>(items: readonly T[], pick: (item: T) => number): number {
  return items.reduce((acc, item) => acc + pick(item), 0);
}
