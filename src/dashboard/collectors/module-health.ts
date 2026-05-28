import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';
import type { HealthTier } from '@/core/types/planning.js';
import { readRawModuleMap } from '@/module-map/reconciler.js';

import { ageInDays, bandForScore } from '../scoring/index.js';
import type { AttentionItem, SectionData } from '../types.js';
import { scanDirectory } from './fs-helpers.js';

interface HealthEntry {
  module?: string;
  tier?: HealthTier;
  updated_at?: string;
}

// Issue #80, AC #29: stale-flag uses the same 14-day window the rollup
// engine does for change_velocity.
const STALE_FLAG_WINDOW_DAYS = 14;

// Returns the ISO timestamp of the most recent commit touching any of
// `sources` within the last `windowDays` days, or null when no such
// commit exists or git is unavailable. Mirrors src/module-health/rollup.ts
// changeVelocity()'s call shape so behaviour stays consistent.
function lastCommitTouchingSources(
  projectRoot: string,
  sources: string[],
  windowDays: number,
): string | null {
  if (sources.length === 0) return null;
  try {
    const out = execFileSync(
      'git',
      ['log', '-1', '--format=%cI', `--since=${windowDays}.days.ago`, '--', ...sources],
      {
        cwd: projectRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      },
    ).trim();
    return out.length > 0 ? out : null;
  } catch {
    return null;
  }
}

const HELPER = {
  what: 'Per-module health, defect density, risk floor, and complexity scores stored under .paqad/module-health/. Drives the graph intelligence overlays.',
  goodLooksLike:
    'Every module classified, no fragile modules, and all entries refreshed in the last 30 days.',
} as const;

interface DistributionEntry {
  tier: HealthTier;
  module: string;
  ageDays: number;
  // ISO timestamp of the entry's updated_at, normalised. Used for the
  // AC #29 stale flag against last-commit-touching-sources.
  updatedAtIso: string | null;
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
  // Phase 4 (f): surfaced for `status --fail-on-drift` composition so the
  // caller doesn't re-walk the module-map + git log itself.
  staleModules: string[];
}

export function collectModuleHealth(
  projectRoot: string,
  now: number = Date.now(),
): ModuleHealthResult {
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
      staleModules: [],
    };
  }

  const entries: DistributionEntry[] = [];
  for (const entry of scanDirectory(dir, { maxDepth: 1, fileFilter: (n) => n.endsWith('.json') })) {
    let parsed: HealthEntry;
    try {
      parsed = JSON.parse(readFileSync(entry.absPath, 'utf8')) as HealthEntry;
    } catch {
      continue;
    }
    const tier: HealthTier =
      parsed.tier === 'stable' ||
      parsed.tier === 'moderate' ||
      parsed.tier === 'fragile' ||
      parsed.tier === 'unknown'
        ? parsed.tier
        : 'unknown';
    const refMs = parsed.updated_at !== undefined ? Date.parse(parsed.updated_at) : NaN;
    const ts = Number.isFinite(refMs) ? refMs : entry.mtimeMs;
    entries.push({
      tier,
      module: parsed.module ?? entry.relPath.replace(/\.json$/, ''),
      ageDays: ageInDays(ts, now) ?? 0,
      updatedAtIso: parsed.updated_at ?? null,
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
      staleModules: [],
    };
  }

  // AC #29 — stale flag: cross-reference each entry's updated_at against the
  // last commit touching the module's sources in module-map.yml (same 14-day
  // window the rollup engine uses). A module is "stale" when sources have
  // commits within the window but updated_at predates the latest such commit.
  const map = readRawModuleMap(projectRoot);
  const sourcesBySlug = new Map<string, string[]>();
  for (const mod of map?.modules ?? []) {
    sourcesBySlug.set(mod.slug, mod.sources);
  }
  const staleModules: string[] = [];
  for (const e of entries) {
    const sources = sourcesBySlug.get(e.module);
    if (sources === undefined || sources.length === 0) continue;
    const lastCommitIso = lastCommitTouchingSources(projectRoot, sources, STALE_FLAG_WINDOW_DAYS);
    if (lastCommitIso === null) continue;
    const updatedMs = e.updatedAtIso !== null ? Date.parse(e.updatedAtIso) : NaN;
    const commitMs = Date.parse(lastCommitIso);
    if (!Number.isFinite(commitMs)) continue;
    // Treat a missing/unparseable updated_at as definitively stale once we
    // know recent commits exist — the rollup never ran here.
    if (!Number.isFinite(updatedMs) || updatedMs < commitMs) {
      staleModules.push(e.module);
    }
  }

  const distribution: Record<HealthTier, number> = {
    stable: 0,
    moderate: 0,
    fragile: 0,
    unknown: 0,
  };
  for (const e of entries) distribution[e.tier] += 1;

  const tierScore =
    entries.reduce<number>((sum, e) => sum + TIER_WEIGHTS[e.tier], 0) / entries.length;
  const oldest = [...entries].sort((a, b) => b.ageDays - a.ageDays)[0];
  // Penalise the section if the oldest entry is itself stale (> 30d).
  const stalenessPenalty = oldest && oldest.ageDays > 30 ? Math.min(20, oldest.ageDays - 30) : 0;
  // AC #29 stale signal: each stale module deducts an additional 5 points, up
  // to a cap of 30, so a project with many stale modules visibly drops out of
  // the green band even when every tier is `stable`.
  const stalePenalty = Math.min(30, staleModules.length * 5);
  const score = Math.max(0, Math.min(100, Math.round(tierScore - stalenessPenalty - stalePenalty)));

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
  for (const slug of staleModules.slice(0, 3)) {
    attention.push({
      sectionId: 'module-health',
      message: `Module \`${slug}\` health predates recent source commits — run \`paqad-ai module-health rollup\`.`,
      severity: 'warn',
    });
  }
  if (staleModules.length > 3) {
    attention.push({
      sectionId: 'module-health',
      message: `${staleModules.length - 3} more module(s) have stale health.`,
      severity: 'warn',
    });
  }

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
        stale_modules: staleModules,
      },
    },
    attention,
    staleModules,
  };
}
