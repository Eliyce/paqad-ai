import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';
import type { HealthTier } from '@/core/types/planning.js';

import { ageInDays, bandForScore } from '../scoring/index.js';
import type { AttentionItem, SectionData } from '../types.js';
import { scanDirectory } from './fs-helpers.js';

interface HealthEntry {
  module?: string;
  tier?: HealthTier;
  updated_at?: string;
}

const HELPER = {
  what: 'Per-module health, defect density, risk floor, and complexity scores stored under .paqad/module-health/. Drives the graph intelligence overlays.',
  goodLooksLike: 'Every module classified, no fragile modules, and all entries refreshed in the last 30 days.',
} as const;

interface DistributionEntry {
  tier: HealthTier;
  module: string;
  ageDays: number;
}

const TIER_WEIGHTS: Record<HealthTier, number> = {
  stable: 100,
  moderate: 70,
  fragile: 25,
  unknown: 0,
};

export interface ModuleHealthResult {
  section: SectionData;
  attention: AttentionItem[];
}

export function collectModuleHealth(projectRoot: string, now: number = Date.now()): ModuleHealthResult {
  const dir = join(projectRoot, PATHS.PLANNING_MODULE_HEALTH_DIR);
  if (!existsSync(dir)) {
    return {
      section: {
        id: 'module-health',
        title: 'Module health',
        band: 'unknown',
        score: null,
        summary: 'No module-health entries — run `paqad-ai module-health sync`.',
        metrics: [],
        helper: HELPER,
      },
      attention: [],
    };
  }

  const entries: DistributionEntry[] = [];
  for (const entry of scanDirectory(dir, { maxDepth: 1, fileFilter: (n) => n.endsWith('.json') })) {
    let parsed: HealthEntry | null = null;
    try {
      parsed = JSON.parse(readFileSync(entry.absPath, 'utf8')) as HealthEntry;
    } catch {
      continue;
    }
    const tier: HealthTier =
      parsed.tier === 'stable' || parsed.tier === 'moderate' || parsed.tier === 'fragile' || parsed.tier === 'unknown'
        ? parsed.tier
        : 'unknown';
    const refMs = parsed.updated_at !== undefined ? Date.parse(parsed.updated_at) : NaN;
    const ts = Number.isFinite(refMs) ? refMs : entry.mtimeMs;
    entries.push({
      tier,
      module: parsed.module ?? entry.relPath.replace(/\.json$/, ''),
      ageDays: ageInDays(ts, now) ?? 0,
    });
  }

  if (entries.length === 0) {
    return {
      section: {
        id: 'module-health',
        title: 'Module health',
        band: 'unknown',
        score: null,
        summary: 'module-health directory is empty.',
        metrics: [],
        helper: HELPER,
      },
      attention: [],
    };
  }

  const distribution: Record<HealthTier, number> = { stable: 0, moderate: 0, fragile: 0, unknown: 0 };
  for (const e of entries) distribution[e.tier] += 1;

  const tierScore =
    entries.reduce<number>((sum, e) => sum + TIER_WEIGHTS[e.tier], 0) / entries.length;
  const oldest = [...entries].sort((a, b) => b.ageDays - a.ageDays)[0];
  // Penalise the section if the oldest entry is itself stale (> 30d).
  const stalenessPenalty = oldest && oldest.ageDays > 30 ? Math.min(20, oldest.ageDays - 30) : 0;
  const score = Math.max(0, Math.min(100, Math.round(tierScore - stalenessPenalty)));

  const fragile = entries.filter((e) => e.tier === 'fragile');
  const summary =
    fragile.length > 0
      ? `${distribution.stable} stable · ${distribution.moderate} moderate · ${fragile.length} fragile`
      : `${distribution.stable} stable · ${distribution.moderate} moderate · ${distribution.unknown} unknown`;

  const attention: AttentionItem[] = fragile.slice(0, 3).map((e) => ({
    sectionId: 'module-health',
    message: `Module \`${e.module}\` is fragile`,
    severity: 'critical',
  }));

  return {
    section: {
      id: 'module-health',
      title: 'Module health',
      band: bandForScore(score),
      score,
      summary,
      metrics: [
        { label: 'stable', value: String(distribution.stable) },
        { label: 'moderate/fragile', value: `${distribution.moderate}/${distribution.fragile}` },
        { label: 'oldest', value: oldest ? `${oldest.ageDays}d` : '—' },
      ],
      helper: HELPER,
      details: {
        distribution,
        entries: entries.map((e) => ({ module: e.module, tier: e.tier, ageDays: e.ageDays })),
      },
    },
    attention,
  };
}
