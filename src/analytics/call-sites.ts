import { ANALYTICS_PROVIDERS, type AnalyticsProviderId } from './providers.js';

export interface AnalyticsCallSite {
  provider: AnalyticsProviderId;
  eventName: string;
}

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
