import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';

import { ageInDays, bandForScore, scoreFreshness } from '../scoring/index.js';
import type { SectionData } from '../types.js';
import { fileMtime } from './fs-helpers.js';

const HELPER = {
  what: '.paqad/session/handoff.{md,json} captures the structured v2 handoff (active task, decisions, blockers) written when an agent finishes a session.',
  goodLooksLike: 'A handoff file written in the last 7 days, ready for the next session to pick up from.',
} as const;

export function collectSession(projectRoot: string, now: number = Date.now()): SectionData {
  const handoffMd = join(projectRoot, PATHS.HANDOFF);
  const handoffJson = join(projectRoot, PATHS.HANDOFF_JSON);
  const mdMtime = fileMtime(handoffMd);
  const jsonMtime = fileMtime(handoffJson);

  if (mdMtime === null && jsonMtime === null) {
    // The session dir itself might exist without a handoff — that's fine,
    // it just means no handoff has been written yet.
    const sessionDir = join(projectRoot, PATHS.AGENCY_SESSION_DIR);
    return {
      id: 'session',
      title: 'Session continuity',
      band: 'unknown',
      score: null,
      summary: existsSync(sessionDir)
        ? 'No handoff written yet.'
        : 'No session artifacts — not using session continuity.',
      metrics: [],
      helper: HELPER,
    };
  }

  const newest = Math.max(mdMtime ?? 0, jsonMtime ?? 0);
  // Use a tighter window for session freshness — handoffs go stale fast.
  const freshness = scoreFreshness(newest, { now, freshWindowDays: 7, staleCliffDays: 60 });
  const age = ageInDays(newest, now);

  return {
    id: 'session',
    title: 'Session continuity',
    band: bandForScore(freshness),
    score: freshness,
    summary: `Handoff ${age !== null ? `${age}d old` : 'present'}${
      mdMtime !== null && jsonMtime !== null ? ' · md + json' : ''
    }`,
    metrics: [
      { label: 'handoff.md', value: mdMtime !== null ? '✓' : '—' },
      { label: 'handoff.json', value: jsonMtime !== null ? '✓' : '—' },
      { label: 'age', value: age !== null ? `${age}d` : '—' },
    ],
    helper: HELPER,
    details: {
      handoffMdMtimeMs: mdMtime,
      handoffJsonMtimeMs: jsonMtime,
    },
  };
}
