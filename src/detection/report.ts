import type { ActiveCapability, Capability, Domain, Stack } from '@/core/types/domain.js';
import type { DetectionReport, DetectionSignal } from '@/core/types/health.js';
import type { RepositoryContext } from '@/core/types/repository.js';

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
  repository?: RepositoryContext;
}

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
    signals: input.signals,
    timestamp: new Date().toISOString(),
    repository: input.repository,
  };
}
