// Dashboard collector for prospective MD-XXXX module decisions
// (issue #80 Phase 4, AC #30 + #32).
//
// Reads .paqad/decisions/module-decisions/*.yml and surfaces every pending
// (proposed) and expired decision as an attention item. The `paqad-ai status
// --fail-on-drift` flag treats expired decisions as a hard signal.

import { listDecisions } from '@/module-decisions/store.js';
import type { ModuleDecision } from '@/module-decisions/schema.js';
import { isExpired } from '@/module-decisions/schema.js';

import { bandForScore } from '../scoring/index.js';
import type { AttentionItem, SectionData } from '../types.js';

const HELPER = {
  what: 'Prospective MD-XXXX decisions written by the Attribution Gate during planning. Pending decisions are awaiting user approval; expired decisions outlived their TTL without being accepted.',
  goodLooksLike:
    'No pending or expired decisions. Run `paqad-ai module-decisions expire-stale` to sweep expired entries; accept or reject pending ones via the planning flow.',
} as const;

export interface ModuleDecisionsResult {
  section: SectionData;
  attention: AttentionItem[];
  // Phase 4f: surfaced for status --fail-on-drift composition.
  expiredIds: string[];
}

interface Buckets {
  proposed: ModuleDecision[];
  expired: ModuleDecision[];
  accepted: ModuleDecision[];
  rejected: ModuleDecision[];
  superseded: ModuleDecision[];
  draft: ModuleDecision[];
}

function bucket(decisions: ModuleDecision[], now: Date): Buckets {
  const buckets: Buckets = {
    proposed: [],
    expired: [],
    accepted: [],
    rejected: [],
    superseded: [],
    draft: [],
  };
  for (const d of decisions) {
    // Proposed entries that have passed TTL but haven't been swept yet count
    // as expired for surfacing purposes. The state field is the source of
    // truth once `expire-stale` runs; this collector is tolerant of either.
    if (d.state === 'proposed' && isExpired(d, now)) {
      buckets.expired.push(d);
      continue;
    }
    buckets[d.state].push(d);
  }
  return buckets;
}

export function collectModuleDecisions(
  projectRoot: string,
  nowMs: number = Date.now(),
): ModuleDecisionsResult {
  const now = new Date(nowMs);
  const all = listDecisions(projectRoot);

  if (all.length === 0) {
    return {
      section: {
        id: 'module-decisions',
        title: 'Module decisions',
        band: 'unknown',
        score: null,
        summary: 'No MD-XXXX decisions on disk.',
        metrics: [],
        helper: HELPER,
      },
      attention: [],
      expiredIds: [],
    };
  }

  const b = bucket(all, now);
  const total = all.length;
  // Each expired entry deducts 12; each pending deducts 4. Floor at 0.
  const score = Math.max(0, 100 - b.expired.length * 12 - b.proposed.length * 4);

  const summaryParts: string[] = [];
  if (b.proposed.length > 0) summaryParts.push(`${b.proposed.length} pending`);
  if (b.expired.length > 0) summaryParts.push(`${b.expired.length} expired`);
  if (b.accepted.length > 0) summaryParts.push(`${b.accepted.length} accepted`);
  const summary =
    summaryParts.length === 0
      ? `${total} decision(s) — none pending or expired`
      : summaryParts.join(' · ');

  const attention: AttentionItem[] = [];
  for (const d of b.expired.slice(0, 3)) {
    attention.push({
      sectionId: 'module-decisions',
      message: `${d.id} (${d.proposed_slug}) expired — run \`paqad-ai module-decisions expire-stale\` or re-propose.`,
      severity: 'warn',
    });
  }
  if (b.expired.length > 3) {
    attention.push({
      sectionId: 'module-decisions',
      message: `${b.expired.length - 3} more expired decision(s).`,
      severity: 'warn',
    });
  }
  if (b.proposed.length > 0) {
    attention.push({
      sectionId: 'module-decisions',
      message: `${b.proposed.length} pending decision(s) awaiting acceptance.`,
      severity: 'info',
    });
  }

  return {
    section: {
      id: 'module-decisions',
      title: 'Module decisions',
      band: bandForScore(score),
      score,
      summary,
      metrics: [
        { label: 'pending', value: String(b.proposed.length) },
        { label: 'expired', value: String(b.expired.length) },
        { label: 'accepted', value: String(b.accepted.length) },
      ],
      helper: HELPER,
      details: {
        counts: {
          draft: b.draft.length,
          proposed: b.proposed.length,
          expired: b.expired.length,
          accepted: b.accepted.length,
          rejected: b.rejected.length,
          superseded: b.superseded.length,
        },
        pending: b.proposed.map((d) => ({
          id: d.id,
          slug: d.proposed_slug,
          expires_at: d.expires_at,
        })),
        expired: b.expired.map((d) => ({
          id: d.id,
          slug: d.proposed_slug,
          expires_at: d.expires_at,
        })),
      },
    },
    attention,
    expiredIds: b.expired.map((d) => d.id),
  };
}
