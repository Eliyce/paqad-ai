import type { ActiveCapability, Capability, Domain, Stack } from '@/core/types/domain.js';
import type { DetectionReport, DetectionSignal } from '@/core/types/health.js';
import type { StackEcosystem } from '@/core/types/introspection.js';
import type { RepositoryContext } from '@/core/types/repository.js';

import { ecosystemToLanguage } from './language-map.js';

interface BuildDetectionReportInput {
  domain: Domain | null;
  stack: Stack | null;
  capabilities?: Capability[];
  matchedPacks?: string[];
  detectedTraits?: string[];
  recommendedCapabilities?: ActiveCapability[];
  detectionPhase?: DetectionReport['detection_phase'];
  signals: DetectionSignal[];
  confidence: DetectionReport['confidence'];
  /**
   * PQD-423: primary toolchain ecosystem; mapped to a `primary_language` label.
   * Omit/`null` for content-only, ambiguous, or unknown projects.
   */
  ecosystem?: StackEcosystem | null;
  /**
   * PQD-423: explicit numeric confidence in `[0, 1]`. When omitted it is derived
   * from the categorical `confidence`.
   */
  confidenceScore?: number;
  /** PQD-423: detection path that produced the report. Defaults to `'static'`. */
  source?: 'ai' | 'static';
  repository?: RepositoryContext;
}

/** Categorical → numeric confidence mapping used when no explicit score is supplied. */
const CONFIDENCE_SCORE: Record<DetectionReport['confidence'], number> = {
  high: 0.9,
  medium: 0.7,
  low: 0.4,
};

export function buildDetectionReport(input: BuildDetectionReportInput): DetectionReport {
  return {
    detected_domain: input.domain,
    detected_stack: input.stack,
    detected_capabilities: input.capabilities ?? [],
    matched_packs: input.matchedPacks ?? [],
    detected_traits: input.detectedTraits ?? [],
    recommended_capabilities: input.recommendedCapabilities ?? ['content'],
    detection_phase: input.detectionPhase,
    confidence: input.confidence,
    confidence_score: input.confidenceScore ?? CONFIDENCE_SCORE[input.confidence],
    primary_language: ecosystemToLanguage(input.ecosystem ?? null),
    source: input.source ?? 'static',
    signals: input.signals,
    timestamp: new Date().toISOString(),
    repository: input.repository,
  };
}
