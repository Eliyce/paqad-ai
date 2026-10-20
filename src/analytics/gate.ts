import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import type { AnalyticsGateStatus } from '@/core/types/classification.js';

import { detectAnalyticsProvider } from './detect.js';
import type { AnalyticsProviderId } from './providers.js';

export const ANALYTICS_DECISION_PATH = '.paqad/planning/analytics-decision.json';

export interface AnalyticsGateInput {
  projectRoot: string;
  flagEnabled: boolean;
  changeIsFeatureShaped: boolean;
  now?: () => Date;
}

export interface AnalyticsGateDecision {
  status: AnalyticsGateStatus;
  provider?: AnalyticsProviderId;
  providerDisplay?: string;
  convention?: string | null;
  confidence?: 'high' | 'medium' | 'low';
  resolved_at: string;
}

export function resolveAnalyticsGate(input: AnalyticsGateInput): AnalyticsGateDecision {
  const now = input.now ?? (() => new Date());
  const resolved_at = now().toISOString();

  if (!input.flagEnabled) {
    return { status: 'off', resolved_at };
  }
  if (!input.changeIsFeatureShaped) {
    return { status: 'not_applicable', resolved_at };
  }
  const detection = detectAnalyticsProvider(input.projectRoot);
  if (!detection) {
    return { status: 'dormant', resolved_at };
  }
  return {
    status: 'instrument',
    provider: detection.provider,
    providerDisplay: detection.providerDisplay,
    convention: detection.convention,
    confidence: detection.confidence,
    resolved_at,
  };
}

export function readAnalyticsDecision(projectRoot: string): AnalyticsGateDecision | null {
  try {
    return JSON.parse(
      readFileSync(join(projectRoot, ANALYTICS_DECISION_PATH), 'utf8'),
    ) as AnalyticsGateDecision;
  } catch {
    return null;
  }
}

export function resolveAndPersistAnalyticsGate(input: AnalyticsGateInput): AnalyticsGateDecision {
  const decision = resolveAnalyticsGate(input);
  const abs = join(input.projectRoot, ANALYTICS_DECISION_PATH);
  try {
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, `${JSON.stringify(decision, null, 2)}\n`, 'utf8');
    /* v8 ignore next 3 -- best-effort sidecar write; a fs failure is not reproduced in tests */
  } catch {}
  return decision;
}
