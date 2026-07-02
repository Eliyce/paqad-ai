// Analytics call-site extraction (issue #241). Given source text, pull out the analytics
// events it tracks — the (provider, event) pairs. Used two ways: detection reads it to learn
// the project's layer-2 convention (how THIS codebase tracks), and the ledger live-writer
// reads it to know which tag a mutating edit just introduced. One extractor, so "what counts
// as a tag" is defined in exactly one place.

import { ANALYTICS_PROVIDERS, type AnalyticsProviderId } from './providers.js';

export interface AnalyticsCallSite {
  provider: AnalyticsProviderId;
  eventName: string;
}

/**
 * Every analytics event call found in `source`, in order, de-duplicated by (provider,event).
 * Pure and allocation-light: each provider pattern is cloned with the global flag so the
 * shared catalog regex is never mutated.
 */
export function extractCallSites(source: string): AnalyticsCallSite[] {
  const out: AnalyticsCallSite[] = [];
  const seen = new Set<string>();
  for (const provider of ANALYTICS_PROVIDERS) {
    for (const pattern of provider.callSitePatterns) {
      const global = new RegExp(pattern.source, 'g');
      let match: RegExpExecArray | null;
      while ((match = global.exec(source)) !== null) {
        const eventName = match[1];
        /* v8 ignore next -- capture group 1 is always present for these patterns */
        if (!eventName) continue;
        const key = `${provider.id}:${eventName}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ provider: provider.id, eventName });
      }
    }
  }
  return out;
}

/** Infer a naming convention label from observed event names (e.g. `snake_case`). */
export function inferNamingConvention(eventNames: readonly string[]): string | null {
  if (eventNames.length === 0) {
    return null;
  }
  const isSnake = (n: string): boolean => /^[a-z0-9]+(?:_[a-z0-9]+)*$/.test(n);
  const isCamel = (n: string): boolean => /^[a-z][a-zA-Z0-9]*$/.test(n) && /[A-Z]/.test(n);
  const isTitleSpace = (n: string): boolean => /^[A-Z][a-z]+(?: [A-Z][a-z]+)+$/.test(n);
  if (eventNames.every(isSnake)) return 'snake_case';
  if (eventNames.every(isCamel)) return 'camelCase';
  if (eventNames.every(isTitleSpace)) return 'Title Case';
  return 'mixed';
}
