// Analytics-provider detection signals (issue #241). A thin, sibling-consistent wrapper (see
// detectShortVideoSignals) over the analytics detector, so the provider + convention show up
// as standard `DetectionSignal`s. Read-only inference; the flag alone authorizes any write.

import type { DetectionSignal } from '@/core/types/health.js';
import { detectAnalyticsProvider } from '@/analytics/detect.js';

export function detectAnalyticsSignals(projectRoot: string): DetectionSignal[] {
  const detection = detectAnalyticsProvider(projectRoot);
  return detection?.signals ?? [];
}
