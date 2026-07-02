// Analytics provider + convention detection (issue #241). Read-only inference from the
// codebase — the user never names the tool, the code tells us. Two layers: (1) WHICH provider
// is wired (deps + env + HTML/entry signals), and (2) HOW this codebase tracks (the call-site
// convention — the correctness key). Detection informs; it has ZERO authority to write. The
// flag alone authorizes instrumentation.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import type { DetectionSignal } from '@/core/types/health.js';

import { extractCallSites, inferNamingConvention } from './call-sites.js';
import {
  ANALYTICS_PROVIDERS,
  type AnalyticsProvider,
  type AnalyticsProviderId,
} from './providers.js';

export interface AnalyticsDetection {
  provider: AnalyticsProviderId;
  providerDisplay: string;
  /** Layer-2 naming convention observed at call sites, when any (e.g. `snake_case`). */
  convention: string | null;
  confidence: 'high' | 'medium' | 'low';
  signals: DetectionSignal[];
}

/** Signal weights — call sites (real usage, defines the convention) beat everything. */
const WEIGHT = { callSite: 4, pkg: 3, entry: 3, env: 1 } as const;

function readJson(path: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Collect a bounded sample of source files to scan for call sites (kept cheap). */
function sampleSourceFiles(projectRoot: string, limit = 200): string[] {
  const out: string[] = [];
  const roots = ['src', 'app', 'lib', 'pages', 'components'];
  const walk = (dir: string): void => {
    if (out.length >= limit) return;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (out.length >= limit) return;
      if (entry === 'node_modules' || entry === '.git' || entry.startsWith('.')) continue;
      const full = join(dir, entry);
      let stats;
      /* v8 ignore start -- fs race between readdir and stat, not reproduced in tests */
      try {
        stats = statSync(full);
      } catch {
        continue;
      }
      /* v8 ignore stop */
      if (stats.isDirectory()) {
        walk(full);
      } else if (/\.[cm]?[jt]sx?$/.test(entry)) {
        out.push(full);
      }
    }
  };
  for (const r of roots) {
    walk(join(projectRoot, r));
  }
  return out;
}

interface ProviderEvidence {
  score: number;
  signals: DetectionSignal[];
  events: string[];
}

function evidenceFor(
  provider: AnalyticsProvider,
  ctx: {
    deps: Record<string, unknown>;
    envText: string;
    entryText: string;
    sources: { file: string; text: string }[];
  },
): ProviderEvidence {
  const signals: DetectionSignal[] = [];
  const events: string[] = [];
  let score = 0;

  for (const pkg of provider.packages) {
    if (ctx.deps[pkg] !== undefined) {
      score += WEIGHT.pkg;
      signals.push({
        signal: `package dependency ${pkg}`,
        file: 'package.json',
        implies: provider.id,
        confidence: 'high',
      });
    }
  }
  for (const pattern of provider.entryPatterns) {
    if (pattern.test(ctx.entryText)) {
      score += WEIGHT.entry;
      signals.push({
        signal: `entry/script signal ${pattern.source}`,
        file: 'index.html',
        implies: provider.id,
        confidence: 'high',
      });
    }
  }
  for (const pattern of provider.envKeyPatterns) {
    if (pattern.test(ctx.envText)) {
      score += WEIGHT.env;
      signals.push({
        signal: `env key ${pattern.source}`,
        file: '.env',
        implies: provider.id,
        confidence: 'low',
      });
    }
  }
  for (const { file, text } of ctx.sources) {
    for (const site of extractCallSites(text)) {
      if (site.provider !== provider.id) continue;
      score += WEIGHT.callSite;
      events.push(site.eventName);
      signals.push({
        signal: `call site ${site.eventName}`,
        file,
        implies: provider.id,
        confidence: 'high',
      });
    }
  }
  return { score, signals, events };
}

/**
 * Detect the wired analytics provider and its convention, or null when none is found.
 * Highest-confidence signal wins; call sites break ties and define the convention.
 */
export function detectAnalyticsProvider(projectRoot: string): AnalyticsDetection | null {
  const pkg = readJson(join(projectRoot, 'package.json')) ?? {};
  const deps = {
    ...(pkg.dependencies as Record<string, unknown> | undefined),
    ...(pkg.devDependencies as Record<string, unknown> | undefined),
  };
  const readIf = (rel: string): string => {
    const p = join(projectRoot, rel);
    return existsSync(p) ? safeRead(p) : '';
  };
  const envText = ['.env', '.env.local', '.env.production', '.env.example'].map(readIf).join('\n');
  const entryText = ['index.html', 'public/index.html', 'app/index.html', 'src/index.html']
    .map(readIf)
    .join('\n');
  const sources = sampleSourceFiles(projectRoot).map((file) => ({
    file: file.slice(projectRoot.length + 1).replace(/\\/g, '/'),
    text: safeRead(file),
  }));

  const ctx = { deps, envText, entryText, sources };
  let best: { provider: AnalyticsProvider; evidence: ProviderEvidence } | null = null;
  for (const provider of ANALYTICS_PROVIDERS) {
    const evidence = evidenceFor(provider, ctx);
    if (evidence.score === 0) continue;
    if (!best || evidence.score > best.evidence.score) {
      best = { provider, evidence };
    }
  }
  if (!best) {
    return null;
  }

  const { provider, evidence } = best;
  const confidence =
    evidence.score >= WEIGHT.callSite ? 'high' : evidence.score >= WEIGHT.pkg ? 'medium' : 'low';
  return {
    provider: provider.id,
    providerDisplay: provider.displayName,
    convention: inferNamingConvention(evidence.events),
    confidence,
    signals: evidence.signals,
  };
}

function safeRead(path: string): string {
  /* v8 ignore start -- unreadable-file race, not reproduced in tests */
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return '';
  }
  /* v8 ignore stop */
}
