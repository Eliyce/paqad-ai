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
  ecosystem?: StackEcosystem | null;
  confidenceScore?: number;
  source?: 'ai' | 'static';
  repository?: RepositoryContext;
}

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
