import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { readConfigsDir, readDotConfig } from '@/core/framework-config.js';
import { resolveFlooredMode } from '@/core/floored-mode.js';

import { analyticsEventDocPath } from './doc-tree.js';

export type AnalyticsStrictness = 'off' | 'warn' | 'strict';

export const ANALYTICS_STRICTNESS_MODES = ['off', 'warn', 'strict'] as const;

export const DEFAULT_ANALYTICS_STRICTNESS: AnalyticsStrictness = 'warn';

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
  verdict: 'ok' | 'warn' | 'block';
  missingDocs: string[];
}

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
