import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';

import type { FrameworkApiSymbol } from './types.js';

export const LARAVEL_UPGRADE_GUIDE_URL =
  'https://raw.githubusercontent.com/laravel/docs/{major}.x/upgrade.md';

export const UPGRADE_GUIDE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const FETCH_TIMEOUT_MS = 5000;

const SYMBOL_PATTERN = /`?([A-Za-z_][\w\\]*)::(\w+)\(\)?`?/g;

const DEPRECATION_HEADING = /^#{2,6}\s+.*\b(deprecat|remov)\w*/i;

const DEPRECATION_SENTENCE =
  /\b(is|are|has been|have been|was|were)\s+(deprecated|removed)\b|\bdeprecated\s+(alias|aliases|in favou?r)\b/i;

const REMOVAL_PHRASE = /\bremov\w*/i;

const CACHE_PARSER_VERSION = 1;

const CACHEABLE_SYMBOL = /^[A-Za-z_][A-Za-z0-9_\\]*::[A-Za-z0-9_]+$/;

export function upgradeGuideCachePath(projectRoot: string, major: string): string {
  return join(projectRoot, PATHS.INDEXES_DIR, 'cache', `laravel-upgrade-${major}.json`);
}

export function majorOf(version: string): string | null {
  return /^v?(\d{1,4})(?:\D|$)/.exec(version.trim())?.[1] ?? null;
}

interface GuideCache {
  fetched_at: number;
  parser_version: number;
  records: FrameworkApiSymbol[];
}

function cacheable(records: FrameworkApiSymbol[], major: string): FrameworkApiSymbol[] {
  const safe: FrameworkApiSymbol[] = [];
  for (const record of records) {
    if (!CACHEABLE_SYMBOL.test(record.name)) {
      continue;
    }
    safe.push({
      name: record.name,
      kind: 'member',
      exists: true,
      deprecated: true,
      message: `The Laravel ${major}.x upgrade guide lists this as ${record.for_removal ? 'removed' : 'deprecated'}.`,
      since: major,
      for_removal: record.for_removal,
      provenance: 'doc-derived',
    });
  }
  return safe;
}

function readCache(path: string, maxAgeMs: number, now: number): FrameworkApiSymbol[] | null {
  try {
    const cached = JSON.parse(readFileSync(path, 'utf8')) as Partial<GuideCache>;
    if (
      !Array.isArray(cached.records) ||
      typeof cached.fetched_at !== 'number' ||
      cached.parser_version !== CACHE_PARSER_VERSION
    ) {
      return null;
    }
    return now - cached.fetched_at <= maxAgeMs ? cached.records : null;
  } catch {
    return null;
  }
}

function writeCache(path: string, records: FrameworkApiSymbol[], now: number): void {
  try {
    mkdirSync(dirname(path), { recursive: true });
    const tmp = `${path}.tmp`;
    const payload: GuideCache = {
      fetched_at: now,
      parser_version: CACHE_PARSER_VERSION,
      records,
    };
    writeFileSync(tmp, JSON.stringify(payload), 'utf8');
    renameSync(tmp, path);
    /* v8 ignore next 4 -- a cache that cannot be written costs a re-fetch next build, which is not worth failing an index build over. */
  } catch {}
}

export interface UpgradeGuideOptions {
  offline?: boolean;
  fetchImpl?: typeof globalThis.fetch;
  now?: () => number;
  maxAgeMs?: number;
}

export async function loadLaravelDeprecations(
  projectRoot: string,
  version: string,
  options: UpgradeGuideOptions = {},
): Promise<FrameworkApiSymbol[] | null> {
  const major = majorOf(version);
  if (major === null) {
    return null;
  }
  const path = upgradeGuideCachePath(projectRoot, major);
  const now = (options.now ?? (() => Date.now()))();
  const maxAge = options.maxAgeMs ?? UPGRADE_GUIDE_MAX_AGE_MS;

  const cached = readCache(path, maxAge, now);
  if (cached !== null) {
    return cached;
  }
  if (options.offline === true) {
    return readCache(path, Number.POSITIVE_INFINITY, now);
  }

  /* v8 ignore next -- the tests always inject a fetch; the fallback is the real network call this module exists to make. */
  const request = options.fetchImpl ?? globalThis.fetch;
  try {
    const response = await request(LARAVEL_UPGRADE_GUIDE_URL.replace('{major}', major), {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) {
      return readCache(path, Number.POSITIVE_INFINITY, now);
    }
    const records = cacheable(parseUpgradeGuide(await response.text(), major), major);
    writeCache(path, records, now);
    return records;
  } catch {
    return readCache(path, Number.POSITIVE_INFINITY, now);
  }
}

export function parseUpgradeGuide(markdown: string, version: string): FrameworkApiSymbol[] {
  const records = new Map<string, FrameworkApiSymbol>();
  const major = majorOf(version) ?? version;
  let heading = 'deprecations';
  let headingIsDeprecation = false;
  let sectionRemoval = false;

  const collect = (text: string, source: string, removal: boolean): void => {
    for (const match of text.matchAll(SYMBOL_PATTERN)) {
      const name = `${match[1] as string}::${match[2] as string}`;
      const existing = records.get(name);
      if (existing !== undefined) {
        existing.for_removal = existing.for_removal || removal;
        continue;
      }
      records.set(name, {
        name,
        kind: 'member',
        exists: true,
        deprecated: true,
        message: `The Laravel ${major}.x upgrade guide lists this under "${source}".`,
        since: major,
        for_removal: removal,
        provenance: 'doc-derived',
      });
    }
  };

  for (const line of markdown.split('\n')) {
    if (line.startsWith('#')) {
      heading = line.replace(/^#+\s*/, '').trim();
      headingIsDeprecation = DEPRECATION_HEADING.test(line);
      sectionRemoval = REMOVAL_PHRASE.test(heading);
      if (headingIsDeprecation) {
        collect(heading, heading, sectionRemoval);
      }
      continue;
    }
    if (headingIsDeprecation) {
      sectionRemoval = sectionRemoval || REMOVAL_PHRASE.test(line);
      collect(line, heading, sectionRemoval);
      continue;
    }
    if (DEPRECATION_SENTENCE.test(line)) {
      collect(line, heading, REMOVAL_PHRASE.test(line));
    }
  }
  return [...records.values()];
}

export function mergeDocDerived(
  asserted: FrameworkApiSymbol[],
  docDerived: FrameworkApiSymbol[],
): FrameworkApiSymbol[] {
  const merged = asserted.map((record) => ({ ...record }));
  for (const record of docDerived) {
    const wanted = record.name.toLowerCase();
    const matches = merged.filter((candidate) => {
      const name = candidate.name.toLowerCase();
      return name === wanted || name.endsWith(`\\${wanted}`) || name.endsWith(`::${wanted}`);
    });
    if (matches.length === 0) {
      merged.push(record);
      continue;
    }
    for (const match of matches) {
      if (match.deprecated || match.provenance === 'unknown-dynamic') {
        continue;
      }
      match.deprecated = true;
      match.message = record.message;
      match.since = record.since;
      match.for_removal = record.for_removal;
      match.provenance = 'doc-derived';
    }
  }
  return merged;
}

export async function applyLaravelBackstop(
  projectRoot: string,
  index: { packages: { package: string; version: string; symbols: FrameworkApiSymbol[] }[] },
  options: UpgradeGuideOptions = {},
): Promise<{ applied: boolean; deprecations: number }> {
  const entry = index.packages.find((candidate) => candidate.package === 'laravel/framework');
  if (entry === undefined) {
    return { applied: false, deprecations: 0 };
  }
  const docDerived = await loadLaravelDeprecations(projectRoot, entry.version, options);
  if (docDerived === null) {
    return { applied: false, deprecations: 0 };
  }
  const before = entry.symbols.filter((record) => record.deprecated).length;
  entry.symbols = mergeDocDerived(entry.symbols, docDerived);
  const after = entry.symbols.filter((record) => record.deprecated).length;
  return { applied: true, deprecations: after - before };
}
