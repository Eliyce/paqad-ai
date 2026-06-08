// Issue #110 — collect the four quality measures into module-attributed samples.
//
// Each measure is normalised to a deficiency count (lower is better) and rolled
// up to every module it touches plus a PROJECT_SCOPE total, reusing the
// module-health rollup's attribution (`assignToModule`) — not a second engine.
//
// The collector is tool-agnostic: it owns only the two measures it can read
// cheaply and exactly without an external tool —
//   - strictness  → tsconfig strict flags (this file's stack)
//   - dead_code   → consumed from #109's reachability/orphan set (no re-scan)
// and delegates the per-language tool measures (tangledness, risky_patterns) to
// injectable runners that an onboarded project wires via its pack. With no
// runner wired the measure is recorded as lower-confidence/blocked — never a
// fabricated number, and a blocked measure never blocks the gate.
//
// Lane behaviour: the `fast` lane collects ONLY strictness, so trivial work is
// not blocked by complexity/dead-code/risky noise — but it still cannot loosen
// the recorded baseline (a strictness-loosening fast change trips the gate).

import type { DetectedStackProfile } from '@/core/types/introspection.js';
import type { Lane } from '@/core/types/routing.js';
import {
  PROJECT_SCOPE,
  type MeasureConfidence,
  type MeasureSample,
  type QualityMeasure,
} from '@/core/types/quality-ratchet.js';
import { readRawModuleMap } from '@/module-map/reconciler.js';
import { assignToModule } from '@/module-health/rollup.js';

import { measureStrictness } from './strictness.js';

/** A deficiency located at a file (e.g. one complexity violation, one finding). */
export interface FileDeficiency {
  file: string;
  count: number;
}

export interface MeasureRunOptions {
  projectRoot: string;
  changedFiles: string[];
  lane: Lane;
  stackProfile: DetectedStackProfile | null;
}

export interface MeasureRunResult {
  tool: string | null;
  confidence: MeasureConfidence;
  files: FileDeficiency[];
}

export interface QualityCollectorDeps {
  /** Per-language complexity tool (e.g. ESLint complexity). Null → blocked. */
  collectTangledness?: (opts: MeasureRunOptions) => Promise<MeasureRunResult | null>;
  /** Risky-pattern / security signal (lint + pentest findings). Null → blocked. */
  collectRiskyPatterns?: (opts: MeasureRunOptions) => Promise<MeasureRunResult | null>;
}

export interface CollectQualityMeasuresOptions extends MeasureRunOptions {
  /**
   * Orphan/unused files from #109's reachability solver. `null` means the
   * traceability map was unavailable this run → dead_code is recorded blocked
   * rather than re-scanned.
   */
  deadCodeFiles: string[] | null;
  deps?: QualityCollectorDeps;
}

type ModuleEntry = { slug: string; sources: string[] };

function readModules(projectRoot: string): ModuleEntry[] {
  const raw = readRawModuleMap(projectRoot);
  return (raw?.modules ?? []).map((mod) => ({ slug: mod.slug, sources: mod.sources }));
}

/**
 * Roll a list of file deficiencies up to a PROJECT_SCOPE total plus a per-module
 * total. Unattributed files still count toward the project total (the project
 * roll-up is the whole truth; modules localise it).
 */
function rollupFileDeficiencies(
  measure: QualityMeasure,
  files: FileDeficiency[],
  modules: ModuleEntry[],
  tool: string | null,
  confidence: MeasureConfidence,
): MeasureSample[] {
  let projectTotal = 0;
  const perModule = new Map<string, number>();

  for (const { file, count } of files) {
    projectTotal += count;
    const slug = assignToModule(file, modules);
    if (slug !== null) {
      perModule.set(slug, (perModule.get(slug) ?? 0) + count);
    }
  }

  const samples: MeasureSample[] = [
    { measure, module: PROJECT_SCOPE, value: projectTotal, confidence, tool, blocked_reason: null },
  ];
  for (const [slug, value] of perModule) {
    samples.push({ measure, module: slug, value, confidence, tool, blocked_reason: null });
  }
  return samples;
}

function blockedSample(measure: QualityMeasure, reason: string): MeasureSample {
  return {
    measure,
    module: PROJECT_SCOPE,
    value: null,
    confidence: 'lower',
    tool: null,
    blocked_reason: reason,
  };
}

/**
 * Collect the four measures for this run. Returns one or more samples per
 * measure (a PROJECT_SCOPE total plus per-module totals where attributable).
 */
export async function collectQualityMeasures(
  options: CollectQualityMeasuresOptions,
): Promise<MeasureSample[]> {
  const modules = readModules(options.projectRoot);
  const runOptions: MeasureRunOptions = {
    projectRoot: options.projectRoot,
    changedFiles: options.changedFiles,
    lane: options.lane,
    stackProfile: options.stackProfile,
  };
  const samples: MeasureSample[] = [];

  // Strictness — always collected (the fast lane's loosen-guard depends on it).
  const strictness = measureStrictness(options.projectRoot);
  samples.push(
    strictness === null
      ? blockedSample('strictness', 'no-tsconfig-or-unparseable')
      : {
          measure: 'strictness',
          module: PROJECT_SCOPE,
          value: strictness.looseness,
          confidence: 'mature',
          tool: 'tsconfig',
          blocked_reason: null,
        },
  );

  // Fast lane stops here: trivial work is not measured for complexity / dead
  // code / risky patterns (noise), but strictness above still cannot loosen.
  if (options.lane === 'fast') {
    return samples;
  }

  // Dead code — consumed from #109, never re-scanned.
  if (options.deadCodeFiles === null) {
    samples.push(blockedSample('dead_code', 'traceability-map-unavailable'));
  } else {
    samples.push(
      ...rollupFileDeficiencies(
        'dead_code',
        options.deadCodeFiles.map((file) => ({ file, count: 1 })),
        modules,
        'traceability-reachability',
        'mature',
      ),
    );
  }

  // Tangledness + risky patterns — per-language tools, wired via deps/pack.
  const tangledness = await safeRun(options.deps?.collectTangledness, runOptions);
  samples.push(...resultToSamples('tangledness', tangledness, modules));

  const risky = await safeRun(options.deps?.collectRiskyPatterns, runOptions);
  samples.push(...resultToSamples('risky_patterns', risky, modules));

  return samples;
}

async function safeRun(
  runner: ((opts: MeasureRunOptions) => Promise<MeasureRunResult | null>) | undefined,
  opts: MeasureRunOptions,
): Promise<MeasureRunResult | null> {
  if (!runner) return null;
  try {
    return await runner(opts);
  } catch {
    // A runner that throws is treated as "no signal" — blocked, never a crash.
    return null;
  }
}

function resultToSamples(
  measure: QualityMeasure,
  result: MeasureRunResult | null,
  modules: ModuleEntry[],
): MeasureSample[] {
  if (result === null) {
    return [blockedSample(measure, 'tool-not-wired')];
  }
  return rollupFileDeficiencies(measure, result.files, modules, result.tool, result.confidence);
}
