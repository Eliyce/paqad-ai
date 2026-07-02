// The complementary analytics gate (issue #241). Decides — cheapest signal first, short
// -circuiting — whether the analytics pass runs, and persists the decision as a sidecar the
// later stages read (so there is no second analysis pass; convention discovery happens once).
//
//   analytics pass = flag ON  AND  change is feature-shaped  AND  provider detected
//
// All three are resolvable at classify time. OFF is free AND silent: when the flag is off we
// do not even run detection.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import type { AnalyticsGateStatus } from '@/core/types/classification.js';

import { detectAnalyticsProvider } from './detect.js';
import type { AnalyticsProviderId } from './providers.js';

/** Repo-relative path to the carry-forward sidecar the later stages read. */
export const ANALYTICS_DECISION_PATH = '.paqad/planning/analytics-decision.json';

export interface AnalyticsGateInput {
  projectRoot: string;
  /** `analytics_instrumentation` resolved from config. */
  flagEnabled: boolean;
  /** Whether the classifier judged this a feature / user-facing change. */
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

/**
 * Resolve the analytics gate without side effects. Detection runs ONLY when the flag is on
 * and the change is feature-shaped (cheapest checks first).
 */
export function resolveAnalyticsGate(input: AnalyticsGateInput): AnalyticsGateDecision {
  const now = input.now ?? (() => new Date());
  const resolved_at = now().toISOString();

  // 1. Flag check — one config key. OFF ⇒ stop, do not detect (OFF is free).
  if (!input.flagEnabled) {
    return { status: 'off', resolved_at };
  }
  // 2. Change-type check — the classifier already computed this.
  if (!input.changeIsFeatureShaped) {
    return { status: 'not_applicable', resolved_at };
  }
  // 3. Detection — only now do we scan for a provider.
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

/**
 * Read the persisted analytics decision sidecar, or null when it is absent or unreadable. The
 * later feature-development stages read this instead of re-deriving the gate (issue #279).
 */
export function readAnalyticsDecision(projectRoot: string): AnalyticsGateDecision | null {
  try {
    return JSON.parse(
      readFileSync(join(projectRoot, ANALYTICS_DECISION_PATH), 'utf8'),
    ) as AnalyticsGateDecision;
  } catch {
    return null;
  }
}

/**
 * Resolve the gate and persist the decision sidecar (best-effort write). Returns the
 * decision either way. Called at planning/classify time so downstream stages just read the
 * sidecar instead of re-deriving.
 */
export function resolveAndPersistAnalyticsGate(input: AnalyticsGateInput): AnalyticsGateDecision {
  const decision = resolveAnalyticsGate(input);
  const abs = join(input.projectRoot, ANALYTICS_DECISION_PATH);
  try {
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, `${JSON.stringify(decision, null, 2)}\n`, 'utf8');
    /* v8 ignore next 3 -- best-effort sidecar write; a fs failure is not reproduced in tests */
  } catch {
    // Best-effort: the decision is still returned for the caller to carry in-memory.
  }
  return decision;
}
