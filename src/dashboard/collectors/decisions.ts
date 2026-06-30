import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';
import { readDecisionEvidence } from '@/planning/decision-ledger.js';

import { ageInDays, bandForScore } from '../scoring/index.js';
import type { AttentionItem, SectionData } from '../types.js';

interface PacketWithAge {
  id: string;
  title: string;
  ageDays: number;
}

const HELPER = {
  what: 'The Decision Pause Contract surfaces every flagged scope/security/architecture choice as a packet in .paqad/decisions/pending/. Agents must wait for resolution before continuing.',
  goodLooksLike: 'Zero pending packets, or pending packets resolved within a couple of days.',
} as const;

/**
 * Score the decisions section. Algorithm:
 *
 * - No decisions dir at all → unknown (project doesn't use the contract).
 * - 0 pending → 100.
 * - For each pending packet, lose points by age:
 *     ≤ 1 day → 10, ≤ 3 days → 20, ≤ 7 days → 35, > 7 days → 50.
 * - Floor at 0.
 */
function scorePending(pending: PacketWithAge[]): number {
  if (pending.length === 0) return 100;
  let penalty = 0;
  for (const p of pending) {
    if (p.ageDays <= 1) penalty += 10;
    else if (p.ageDays <= 3) penalty += 20;
    else if (p.ageDays <= 7) penalty += 35;
    else penalty += 50;
  }
  return Math.max(0, 100 - penalty);
}

export interface DecisionsResult {
  section: SectionData;
  attention: AttentionItem[];
}

export function collectDecisions(projectRoot: string, now: number = Date.now()): DecisionsResult {
  const dir = join(projectRoot, PATHS.DECISIONS_DIR);
  if (!existsSync(dir)) {
    return {
      section: {
        id: 'decisions',
        title: 'Decisions',
        band: 'unknown',
        score: null,
        summary: 'No decisions directory — not using the Decision Pause Contract.',
        metrics: [],
        helper: HELPER,
      },
      attention: [],
    };
  }

  // Buildout F6 (hard cutover, D1) — the dashboard reads decision lifecycle evidence
  // from the session-ledger, not by scanning the packet buckets. The directories stay
  // as the gate's operational teeth; the DecisionStore writes both together so they
  // never drift. The dir's existence above is only the "contract in use" signal.
  const evidence = readDecisionEvidence(projectRoot);
  const pending: PacketWithAge[] = evidence.pending
    .map((p) => {
      const createdAt = p.createdAt !== null ? Date.parse(p.createdAt) : NaN;
      return {
        id: p.id,
        title: p.title,
        ageDays: ageInDays(Number.isFinite(createdAt) ? createdAt : now, now) ?? 0,
      };
    })
    .sort((a, b) => b.ageDays - a.ageDays);
  const resolved = evidence.resolvedCount;
  const expired = evidence.expiredCount;

  const score = scorePending(pending);
  const oldest = pending[0] ?? null;
  const summary =
    pending.length === 0
      ? `Clear · ${resolved} resolved · ${expired} expired`
      : `${pending.length} pending${oldest ? ` · oldest ${oldest.ageDays}d` : ''}`;

  const attention: AttentionItem[] = pending
    .filter((p) => p.ageDays >= 1)
    .slice(0, 3)
    .map((p) => ({
      sectionId: 'decisions',
      message: `Decision ${p.id} pending ${p.ageDays}d — ${p.title}`,
      severity: p.ageDays >= 7 ? 'critical' : p.ageDays >= 3 ? 'warn' : 'info',
    }));

  return {
    section: {
      id: 'decisions',
      title: 'Decisions',
      band: bandForScore(score),
      score,
      summary,
      metrics: [
        { label: 'pending', value: String(pending.length) },
        { label: 'resolved', value: String(resolved) },
        { label: 'expired', value: String(expired) },
      ],
      helper: HELPER,
      details: {
        pending: pending.map((p) => ({ id: p.id, title: p.title, ageDays: p.ageDays })),
      },
    },
    attention,
  };
}
