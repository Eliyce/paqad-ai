// Analytics provider catalog (issue #241). The single source of truth for what paqad knows
// about analytics tools: dependency names, env-key patterns, HTML/entry signals, and the
// call-site patterns that both DETECT usage (layer-2 convention) and EXTRACT the event name
// a tag write introduces. Detection, the ledger live-writer, and the classifier gate all
// read this one catalog so they never drift.
//
// package.json alone is a trap — GA4 is often just a gtag.js script tag with no npm dep — so
// each provider carries multiple orthogonal signal kinds and the highest-confidence one wins.
//
// Host/URL signals are plain substrings matched with `String.includes` (this is content
// DETECTION, not URL sanitization — a substring match is exactly the intent, and it avoids
// the unanchored-hostname regex hazard). Only real id shapes (G-…, GTM-…) need a regex.

export type AnalyticsProviderId =
  'ga4' | 'gtm' | 'segment' | 'posthog' | 'mixpanel' | 'amplitude' | 'vercel' | 'plausible';

export interface AnalyticsProvider {
  id: AnalyticsProviderId;
  displayName: string;
  /** npm dependency names that imply this provider. */
  packages: string[];
  /** Env-key name patterns (e.g. NEXT_PUBLIC_POSTHOG_KEY). */
  envKeyPatterns: RegExp[];
  /** HTML / entry-file host or URL fragments, matched as plain substrings. */
  entrySubstrings: string[];
  /** Measurement / container id shapes (e.g. G-XXXXXX). Anchored on both sides. */
  entryIdPatterns: RegExp[];
  /** Call-site patterns; capture group 1 is the event name. Stored WITHOUT the global
   *  flag — the extractor clones each with `g` so shared state is never mutated. */
  callSitePatterns: RegExp[];
}

export const ANALYTICS_PROVIDERS: readonly AnalyticsProvider[] = [
  {
    id: 'ga4',
    displayName: 'Google Analytics 4',
    packages: ['react-ga4', 'ga-4-react'],
    envKeyPatterns: [/(?:^|_)GA_?MEASUREMENT_?ID/i, /(?:NEXT_PUBLIC_)?GA4?_/i],
    entrySubstrings: ['googletagmanager.com/gtag'],
    entryIdPatterns: [/\bG-[A-Z0-9]{6,}\b/],
    callSitePatterns: [/gtag\(\s*['"]event['"]\s*,\s*['"]([^'"]+)['"]/],
  },
  {
    id: 'gtm',
    displayName: 'Google Tag Manager',
    packages: ['@types/gtag.js'],
    envKeyPatterns: [/(?:^|_)GTM_?(?:ID|CONTAINER)/i],
    entrySubstrings: ['googletagmanager.com/gtm'],
    entryIdPatterns: [/\bGTM-[A-Z0-9]{4,}\b/],
    callSitePatterns: [/dataLayer\.push\(\s*\{\s*['"]?event['"]?\s*:\s*['"]([^'"]+)['"]/],
  },
  {
    id: 'segment',
    displayName: 'Segment',
    packages: ['@segment/analytics-next', 'analytics-node', 'analytics'],
    envKeyPatterns: [/SEGMENT_(?:WRITE_)?KEY/i],
    entrySubstrings: ['cdn.segment.com/analytics.js'],
    entryIdPatterns: [],
    callSitePatterns: [/\banalytics\.track\(\s*['"]([^'"]+)['"]/],
  },
  {
    id: 'posthog',
    displayName: 'PostHog',
    packages: ['posthog-js', 'posthog-node'],
    envKeyPatterns: [/POSTHOG(?:_KEY|_API_KEY|_HOST)?/i],
    entrySubstrings: ['app.posthog.com'],
    entryIdPatterns: [],
    callSitePatterns: [/\bposthog\.capture\(\s*['"]([^'"]+)['"]/],
  },
  {
    id: 'mixpanel',
    displayName: 'Mixpanel',
    packages: ['mixpanel-browser', 'mixpanel'],
    envKeyPatterns: [/MIXPANEL(?:_TOKEN|_KEY)?/i],
    entrySubstrings: ['cdn.mxpnl.com'],
    entryIdPatterns: [],
    callSitePatterns: [/\bmixpanel\.track\(\s*['"]([^'"]+)['"]/],
  },
  {
    id: 'amplitude',
    displayName: 'Amplitude',
    packages: ['@amplitude/analytics-browser', 'amplitude-js'],
    envKeyPatterns: [/AMPLITUDE(?:_API_KEY|_KEY)?/i],
    entrySubstrings: ['cdn.amplitude.com'],
    entryIdPatterns: [],
    callSitePatterns: [/\bamplitude[\w.()]*\.(?:track|logEvent)\(\s*['"]([^'"]+)['"]/],
  },
  {
    id: 'vercel',
    displayName: 'Vercel Analytics',
    packages: ['@vercel/analytics'],
    envKeyPatterns: [/VERCEL_ANALYTICS/i],
    entrySubstrings: ['/_vercel/insights'],
    entryIdPatterns: [],
    callSitePatterns: [/\bva\.track\(\s*['"]([^'"]+)['"]/],
  },
  {
    id: 'plausible',
    displayName: 'Plausible',
    packages: ['plausible-tracker', 'next-plausible'],
    envKeyPatterns: [/PLAUSIBLE_/i],
    entrySubstrings: ['plausible.io/js'],
    entryIdPatterns: [],
    callSitePatterns: [/\bplausible\(\s*['"]([^'"]+)['"]/],
  },
] as const;

/** Look up a provider by id. */
export function findProvider(id: string): AnalyticsProvider | undefined {
  return ANALYTICS_PROVIDERS.find((p) => p.id === id);
}
