import { isLaneStage } from '@/stage-evidence/stages.js';
import type { StageLane } from '@/stage-evidence/types.js';

import { FEATURE_BUNDLE_FILES, type FeatureBundleFile } from './paths.js';

export interface BundleCompletenessConfig {
  lane: StageLane;
  ruleComplianceOn: boolean;
  metricsEnabled: boolean;
  duplicationOn: boolean;
  featureReport: boolean;
  ragEnabled: boolean;
  enterprise: boolean;
  evidenceLedger: boolean;
  aiBom: boolean;
  specPipelineStrict: boolean;
  specPipelineEnabled: boolean;
  expertsEnabled: boolean;
  specFrozenBeforePipeline: boolean;
  stageIsolationExpected: boolean;
  stageIsolationUnresolved: boolean;
}

export type BundleFileValidator = 'json' | 'jsonl>=1' | 'nonempty';

export type BundleManifestKey = FeatureBundleFile | 'report';

export interface BundleManifestEntry {
  key: BundleManifestKey;
  file: string;
  required: 'always' | 'optional' | ((config: BundleCompletenessConfig) => boolean);
  writer: string;
  validate: BundleFileValidator;
  unrecoverable?: boolean;
}

export function laneRunsSpecPipeline(lane: StageLane | undefined): boolean {
  return lane !== 'fast';
}

function laneHasStage(stage: string): (config: BundleCompletenessConfig) => boolean {
  return (config) => isLaneStage(config.lane, stage);
}

export function specPipelineApplies(config: BundleCompletenessConfig): boolean {
  return (
    config.specPipelineEnabled &&
    laneRunsSpecPipeline(config.lane) &&
    !config.specFrozenBeforePipeline
  );
}

export function specPipelineStrictApplies(config: BundleCompletenessConfig): boolean {
  return (
    config.specPipelineStrict &&
    laneRunsSpecPipeline(config.lane) &&
    !config.specFrozenBeforePipeline
  );
}

export const BUNDLE_MANIFEST: readonly BundleManifestEntry[] = [
  {
    key: 'feature',
    file: FEATURE_BUNDLE_FILES.feature,
    required: 'always',
    writer: 'feature mint (paqad-ai stage start / plan compile)',
    validate: 'json',
  },
  {
    key: 'plan',
    file: FEATURE_BUNDLE_FILES.plan,
    required: 'always',
    writer: 'paqad-ai plan compile',
    validate: 'json',
  },
  {
    key: 'specification',
    file: FEATURE_BUNDLE_FILES.specification,
    required: laneHasStage('specification'),
    writer: 'paqad-ai spec freeze',
    validate: 'json',
  },
  {
    key: 'specMd',
    file: FEATURE_BUNDLE_FILES.specMd,
    required: laneHasStage('specification'),
    writer: 'paqad-ai spec freeze',
    validate: 'nonempty',
  },
  {
    key: 'request',
    file: FEATURE_BUNDLE_FILES.request,
    required: specPipelineApplies,
    writer: 'paqad-ai spec pipeline start',
    validate: 'nonempty',
  },
  {
    key: 'clarification',
    file: FEATURE_BUNDLE_FILES.clarification,
    required: specPipelineApplies,
    writer: 'paqad-ai spec pipeline (label + questions)',
    validate: 'json',
  },
  {
    key: 'experts',
    file: FEATURE_BUNDLE_FILES.experts,
    required: (config) => specPipelineApplies(config) && config.expertsEnabled,
    writer: 'paqad-ai spec pipeline experts',
    validate: 'json',
  },
  {
    key: 'highTable',
    file: FEATURE_BUNDLE_FILES.highTable,
    required: 'optional',
    writer:
      'paqad-ai spec pipeline experts (record, brief, context, notes, synthesis) + SubagentStop hook',
    validate: 'jsonl>=1',
  },
  {
    key: 'cost',
    file: FEATURE_BUNDLE_FILES.cost,
    required: 'optional',
    writer: 'Stop and SubagentStop hooks (record-only)',
    validate: 'json',
  },
  {
    key: 'decisions',
    file: FEATURE_BUNDLE_FILES.decisions,
    required: 'optional',
    writer: 'paqad-ai decision resolve (decisions index)',
    validate: 'json',
  },
  {
    key: 'techDebt',
    file: FEATURE_BUNDLE_FILES.techDebt,
    required: 'optional',
    writer: 'paqad-ai debt add (tech-debt index)',
    validate: 'json',
  },
  {
    key: 'ruleOverrides',
    file: FEATURE_BUNDLE_FILES.ruleOverrides,
    required: 'optional',
    writer: 'paqad-ai rules override',
    validate: 'jsonl>=1',
  },
  {
    key: 'fixProof',
    file: FEATURE_BUNDLE_FILES.fixProof,
    required: 'optional',
    writer: 'paqad-ai fix prove',
    validate: 'json',
  },
  {
    key: 'review',
    file: FEATURE_BUNDLE_FILES.review,
    required: laneHasStage('review'),
    writer: 'paqad-ai review record',
    validate: 'json',
  },
  {
    key: 'stageEvidence',
    file: FEATURE_BUNDLE_FILES.stageEvidence,
    required: 'always',
    writer: 'stage recorder',
    validate: 'jsonl>=1',
  },
  {
    key: 'ruleRun',
    file: FEATURE_BUNDLE_FILES.ruleRun,
    required: (config) => config.ruleComplianceOn,
    writer: 'rule-scripts runner',
    validate: 'jsonl>=1',
  },
  {
    key: 'rulesLoaded',
    file: FEATURE_BUNDLE_FILES.rulesLoaded,
    required: 'optional',
    writer: 'paqad-ai rules load',
    validate: 'json',
  },
  {
    key: 'delivery',
    file: FEATURE_BUNDLE_FILES.delivery,
    required: 'always',
    writer: 'feature open + paqad-ai delivery-link + paqad-ai deliver + the Stop delivery check',
    validate: 'json',
  },
  {
    key: 'checks',
    file: FEATURE_BUNDLE_FILES.checks,
    required: 'optional',
    writer: 'paqad-ai checks run',
    validate: 'json',
  },
  {
    key: 'changeMetrics',
    file: FEATURE_BUNDLE_FILES.changeMetrics,
    required: (config) => config.metricsEnabled,
    writer: 'change-metrics collector',
    validate: 'jsonl>=1',
  },
  {
    key: 'duplication',
    file: FEATURE_BUNDLE_FILES.duplication,
    required: (config) => config.duplicationOn,
    writer: 'duplication scan',
    validate: 'jsonl>=1',
  },
  {
    key: 'report',
    file: 'report.html',
    required: (config) => config.featureReport,
    writer: 'feature report renderer (writeFeatureReport)',
    validate: 'nonempty',
  },
  {
    key: 'rag',
    file: FEATURE_BUNDLE_FILES.rag,
    required: (config) => config.ragEnabled,
    writer: 'RAG recorder',
    validate: 'jsonl>=1',
    unrecoverable: true,
  },
  {
    key: 'receipt',
    file: FEATURE_BUNDLE_FILES.receipt,
    required: (config) => config.enterprise && config.evidenceLedger,
    writer: 'projectFeatureReceipt',
    validate: 'json',
  },
  {
    key: 'evidence',
    file: FEATURE_BUNDLE_FILES.evidence,
    required: 'always',
    writer: 'appendFeatureEvidenceRows',
    validate: 'jsonl>=1',
  },
  {
    key: 'aiBom',
    file: FEATURE_BUNDLE_FILES.aiBom,
    required: (config) => config.enterprise && config.aiBom,
    writer: 'projectFeatureReceipt (AI-BOM)',
    validate: 'json',
  },
  {
    key: 'visualEvidence',
    file: FEATURE_BUNDLE_FILES.visualEvidence,
    required: 'optional',
    writer: 'paqad-ai visual-evidence run',
    validate: 'json',
  },
];

export function readSpecAdoption(
  spec: unknown,
): { produced: boolean; manual_reason?: string; fast_lane?: true } | null {
  if (typeof spec !== 'object' || spec === null) return null;
  const record = spec as {
    pipeline?: { produced?: unknown; manual_reason?: unknown; skipped?: unknown };
    provenance?: { pipeline_produced?: unknown; manual_reason?: unknown };
  };
  const section = record.pipeline ?? record.provenance;
  if (typeof section !== 'object' || section === null) return null;
  const produced = record.pipeline
    ? record.pipeline.produced
    : (section as { pipeline_produced?: unknown }).pipeline_produced;
  return {
    produced: produced === true,
    ...(typeof section.manual_reason === 'string' ? { manual_reason: section.manual_reason } : {}),
    ...(record.pipeline?.skipped === 'fast-lane' ? { fast_lane: true as const } : {}),
  };
}

export function isSpecFrozenBeforePipeline(spec: unknown): boolean {
  return typeof spec === 'object' && spec !== null && readSpecAdoption(spec) === null;
}

export function isSpecFrozenOnFastLane(spec: unknown): boolean {
  return readSpecAdoption(spec)?.fast_lane === true;
}

export const FAST_LANE_REFREEZE_HINT =
  'the lane was raised after a fast-lane freeze: re-freeze the spec through the spec pipeline ' +
  '(paqad-ai spec pipeline start, then spec freeze --from-pipeline)';

export function validateSpecificationAdoption(content: string | null): {
  ok: boolean;
  error?: string;
} {
  const failure = {
    ok: false,
    error:
      'specification.json was not produced by the spec pipeline and records no manual reason (spec_pipeline_adoption=strict); re-freeze with --from-pipeline or --manual --reason',
  };
  if (content === null) return failure;
  let adoption: ReturnType<typeof readSpecAdoption>;
  try {
    adoption = readSpecAdoption(JSON.parse(content));
  } catch {
    return failure;
  }
  if (!adoption) return failure;
  if (adoption.produced) return { ok: true };
  if (adoption.fast_lane) {
    return {
      ok: false,
      error: `specification.json was frozen on the fast lane; ${FAST_LANE_REFREEZE_HINT}`,
    };
  }
  if (adoption.manual_reason !== undefined && adoption.manual_reason.trim().length > 0) {
    return { ok: true };
  }
  return failure;
}

export function isBundleFileRequired(
  entry: BundleManifestEntry,
  config: BundleCompletenessConfig,
): boolean {
  if (entry.required === 'always') return true;
  if (entry.required === 'optional') return false;
  return entry.required(config);
}

export function requiredBundleFiles(config: BundleCompletenessConfig): BundleManifestEntry[] {
  return BUNDLE_MANIFEST.filter((entry) => isBundleFileRequired(entry, config));
}

export function validateBundleFileContent(
  validate: BundleFileValidator,
  content: string | null,
): boolean {
  if (content === null) {
    return false;
  }
  switch (validate) {
    case 'json':
      try {
        JSON.parse(content);
        return true;
      } catch {
        return false;
      }
    case 'jsonl>=1':
      return content.split('\n').some((line) => line.trim().length > 0);
    case 'nonempty':
      return content.trim().length > 0;
  }
}
