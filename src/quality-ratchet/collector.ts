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
  collectTangledness?: (opts: MeasureRunOptions) => Promise<MeasureRunResult | null>;
  collectRiskyPatterns?: (opts: MeasureRunOptions) => Promise<MeasureRunResult | null>;
}

export interface CollectQualityMeasuresOptions extends MeasureRunOptions {
  deadCodeFiles: string[] | null;
  deps?: QualityCollectorDeps;
}

type ModuleEntry = { slug: string; sources: string[] };

function readModules(projectRoot: string): ModuleEntry[] {
  const raw = readRawModuleMap(projectRoot);
  return (raw?.modules ?? []).map((mod) => ({ slug: mod.slug, sources: mod.sources }));
}

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

  if (options.lane === 'fast') {
    return samples;
  }

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
