import type { DetectionSignal } from '@/core/types/health.js';
import { detectAnalyticsProvider } from '@/analytics/detect.js';

export function detectAnalyticsSignals(projectRoot: string): DetectionSignal[] {
  const detection = detectAnalyticsProvider(projectRoot);
  return detection?.signals ?? [];
}
