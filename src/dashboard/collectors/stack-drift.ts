import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';
import type { StackDriftReport } from '@/core/types/introspection.js';

import { ageInDays, bandForScore } from '../scoring/index.js';
import type { AttentionItem, SectionData } from '../types.js';
import { fileMtime } from './fs-helpers.js';

const HELPER = {
  what: 'Stack drift compares the locked stack-snapshot.json to the live lockfiles. Material changes (added/removed frameworks, version-band shifts) get listed here.',
  goodLooksLike: 'status: no-drift, regenerated after every dependency change with `paqad-ai refresh`.',
} as const;

function readDrift(path: string): StackDriftReport | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as StackDriftReport;
  } catch {
    return null;
  }
}

export interface StackDriftResult {
  section: SectionData;
  attention: AttentionItem[];
}

export function collectStackDrift(projectRoot: string, now: number = Date.now()): StackDriftResult {
  const driftPath = join(projectRoot, PATHS.STACK_DRIFT);
  const snapshotPath = join(projectRoot, PATHS.STACK_SNAPSHOT);

  const drift = readDrift(driftPath);
  const snapshotPresent = existsSync(snapshotPath);

  if (drift === null) {
    return {
      section: {
        id: 'stack-drift',
        title: 'Stack drift',
        band: 'unknown',
        score: null,
        summary: snapshotPresent
          ? 'No stack-drift.json — run `paqad-ai refresh`.'
          : 'No stack snapshot — run `paqad-ai onboard` or `refresh`.',
        metrics: [],
        helper: HELPER,
      },
      attention: [],
    };
  }

  const generatedMs = Date.parse(drift.generated_at);
  const refMs = Number.isFinite(generatedMs) ? generatedMs : fileMtime(driftPath);
  const age = ageInDays(refMs, now);
  const changes = drift.material_changes ?? [];
  const changeCount = changes.length;

  let score: number;
  if (drift.status === 'no-drift') {
    score = 100;
  } else {
    // Each material change deducts 15, floor at 0. > 90d old drift report
    // adds extra 20 penalty since it's likely no longer accurate.
    let s = 100 - changeCount * 15;
    if (age !== null && age > 90) s -= 20;
    score = Math.max(0, s);
  }

  const summary =
    drift.status === 'no-drift'
      ? `No drift · checked ${age !== null ? `${age}d ago` : 'recently'}`
      : `${changeCount} change(s) detected · ${age !== null ? `${age}d ago` : 'recently'}`;

  const attention: AttentionItem[] =
    drift.status === 'drift-detected' && changeCount > 0
      ? [
          {
            sectionId: 'stack-drift',
            message: `Stack drifted (${changeCount} change${changeCount === 1 ? '' : 's'})`,
            severity: changeCount >= 3 ? 'critical' : 'warn',
          },
        ]
      : [];

  return {
    section: {
      id: 'stack-drift',
      title: 'Stack drift',
      band: bandForScore(score),
      score,
      summary,
      metrics: [
        { label: 'status', value: drift.status },
        { label: 'changes', value: String(changeCount) },
        { label: 'age', value: age !== null ? `${age}d` : '—' },
      ],
      helper: HELPER,
      details: {
        status: drift.status,
        changes: changes.slice(0, 10),
        newly_active_rule_bands: drift.newly_active_rule_bands ?? [],
      },
    },
    attention,
  };
}
