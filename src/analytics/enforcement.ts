// Analytics completeness enforcement (issue #279). The gate input is doc-existence, not the
// ledger: an instrumented event is "complete" when its per-event doc exists. The strictness
// knob `analytics_strictness` decides what a missing doc means — off is silent, warn is a 🟡
// at completion, strict blocks on Done. Modeled on the stages_mode / rule_compliance floor
// clamp: the team value is a floor and a local override may only RAISE strictness.

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { readConfigsDir, readDotConfig } from '@/core/framework-config.js';
import { resolveFlooredMode } from '@/core/floored-mode.js';

import { analyticsEventDocPath } from './doc-tree.js';

export type AnalyticsStrictness = 'off' | 'warn' | 'strict';

/** Modes weakest → strictest, for the floor clamp. */
export const ANALYTICS_STRICTNESS_MODES = ['off', 'warn', 'strict'] as const;

/** Analytics is coding-first: the default never blocks a correct build (confirmed 2026-07-02). */
export const DEFAULT_ANALYTICS_STRICTNESS: AnalyticsStrictness = 'warn';

/**
 * Resolve the analytics strictness mode with the team value as a floor. The tracked
 * `configs/.config.*` value is the floor; the local `.config` and `PAQAD_ANALYTICS_STRICTNESS`
 * env may only RAISE strictness above it. Nothing set ⇒ `warn`.
 */
export function resolveAnalyticsStrictness(
  projectRoot: string,
  env: NodeJS.ProcessEnv = process.env,
): AnalyticsStrictness {
  return resolveFlooredMode(
    {
      team: readConfigsDir(projectRoot).merged.get('analytics_strictness'),
      local: readDotConfig(projectRoot).get('analytics_strictness'),
      env: env.PAQAD_ANALYTICS_STRICTNESS,
    },
    ANALYTICS_STRICTNESS_MODES,
    DEFAULT_ANALYTICS_STRICTNESS,
  );
}

export interface InstrumentedEvent {
  module: string;
  feature: string;
  eventName: string;
}

export interface AnalyticsCompletenessResult {
  mode: AnalyticsStrictness;
  /** `ok` — every event doc exists. `warn` — some missing, non-blocking. `block` — strict, missing. */
  verdict: 'ok' | 'warn' | 'block';
  /** Repo-relative event-doc paths that an instrumented event promised but that do not exist. */
  missingDocs: string[];
}

/**
 * Decide whether the instrumented events are completely documented. The gate is doc-existence:
 * strict requires the EVENT doc to exist (not each provider section — provider detection has
 * confidence, so blocking on a section would false-block). `off` is always `ok`.
 */
export function evaluateAnalyticsCompleteness(input: {
  mode: AnalyticsStrictness;
  events: readonly InstrumentedEvent[];
  docExists: (repoRelPath: string) => boolean;
}): AnalyticsCompletenessResult {
  const { mode, events, docExists } = input;
  if (mode === 'off') {
    return { mode, verdict: 'ok', missingDocs: [] };
  }
  const missing = new Set<string>();
  for (const event of events) {
    const rel = analyticsEventDocPath(event.module, event.feature, event.eventName);
    if (!docExists(rel)) {
      missing.add(rel);
    }
  }
  const missingDocs = [...missing].sort();
  if (missingDocs.length === 0) {
    return { mode, verdict: 'ok', missingDocs };
  }
  return { mode, verdict: mode === 'strict' ? 'block' : 'warn', missingDocs };
}

/**
 * Convenience over {@link evaluateAnalyticsCompleteness} that checks the docs against the real
 * filesystem under `projectRoot` and resolves the strictness mode from config.
 */
export function evaluateAnalyticsCompletenessForProject(
  projectRoot: string,
  events: readonly InstrumentedEvent[],
  env: NodeJS.ProcessEnv = process.env,
): AnalyticsCompletenessResult {
  return evaluateAnalyticsCompleteness({
    mode: resolveAnalyticsStrictness(projectRoot, env),
    events,
    docExists: (rel) => existsSync(join(projectRoot, rel)),
  });
}
