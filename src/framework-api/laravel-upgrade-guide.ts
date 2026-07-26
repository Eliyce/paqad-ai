// The Laravel Upgrade Guide deprecation backstop (issue #398).
//
// Why this exists: Laravel tags deprecations sparsely. A real v13.18.0 install carries 39
// `@deprecated` docblocks and zero `#[\Deprecated]` attributes across the entire framework,
// while its authoritative deprecation record — the one the framework team maintains — is
// the version-pinned Upgrade Guide. A record read from there is `doc-derived`: true, but
// from prose rather than from a declaration, and the index says so rather than passing it
// off as an asserted fact.
//
// This is the ONE place the framework-API index reaches the network, by decision
// D-01KYEQSEE1YV11T9VN9M2AKME7, which amends #397's zero-network invariant for this source.
// It is fenced accordingly: the fetch is cached per major version, skipped entirely under
// `offline`, and a failure produces no records instead of an error — the index is never
// worse off for the network being unavailable (FR-13).

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';

import type { FrameworkApiSymbol } from './types.js';

/** Where the version-pinned guide is published. `{major}` is the installed major version. */
export const LARAVEL_UPGRADE_GUIDE_URL =
  'https://raw.githubusercontent.com/laravel/docs/{major}.x/upgrade.md';

/** How long a cached guide is trusted before it is fetched again. */
export const UPGRADE_GUIDE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** How long the fetch may take before it is abandoned and the build carries on. */
const FETCH_TIMEOUT_MS = 5000;

/** A `Str::foo()`, `Foo::bar()` or `Illuminate\Support\Str::foo()` mention in the guide. */
const SYMBOL_PATTERN = /`?([A-Za-z_][\w\\]*)::(\w+)\(\)?`?/g;

/**
 * A heading that declares its whole section to be about a deprecation or removal, e.g.
 * `#### Deprecated Schema Methods` in the 11.x guide.
 */
const DEPRECATION_HEADING = /^#{2,6}\s+.*\b(deprecat|remov)\w*/i;

/**
 * A prose line that states a deprecation or removal outright, e.g. "The
 * `Blueprint::getPrefix()` method is deprecated." in the 12.x guide.
 *
 * Both signals are needed because the guides use both shapes, and neither alone finds much:
 * the 13.x guide names its sections after the CHANGE rather than the word "deprecated", and
 * the 12.x guide states most of its removals in running prose under a neutral heading.
 */
const DEPRECATION_SENTENCE =
  /\b(is|are|has been|have been|was|were)\s+(deprecated|removed)\b|\bdeprecated\s+(alias|aliases|in favou?r)\b/i;

/** Whether a matched phrase means gone, not merely discouraged. */
const REMOVAL_PHRASE = /\bremov\w*/i;

/** The on-disk cache for one major version's guide. */
export function upgradeGuideCachePath(projectRoot: string, major: string): string {
  return join(projectRoot, PATHS.INDEXES_DIR, 'cache', `laravel-upgrade-${major}.md`);
}

/** The major version of a resolved semver-ish version string (`13.18.0` -> `13`). */
export function majorOf(version: string): string {
  return (/^v?(\d+)/.exec(version)?.[1] ?? version).trim();
}

/** Read the cached guide when it exists and is younger than `maxAgeMs`. */
function readCache(path: string, maxAgeMs: number, now: number): string | null {
  try {
    const cached = JSON.parse(readFileSync(path, 'utf8')) as { fetched_at?: number; body?: string };
    if (typeof cached.body !== 'string' || typeof cached.fetched_at !== 'number') {
      return null;
    }
    return now - cached.fetched_at <= maxAgeMs ? cached.body : null;
  } catch {
    return null;
  }
}

/** Persist a fetched guide, atomically, so a killed build leaves no half-written cache. */
function writeCache(path: string, body: string, now: number): void {
  try {
    mkdirSync(dirname(path), { recursive: true });
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, JSON.stringify({ fetched_at: now, body }), 'utf8');
    renameSync(tmp, path);
    /* v8 ignore next 4 -- a cache that cannot be written costs a re-fetch next build, which is not worth failing an index build over. */
  } catch {
    // Deliberately empty: the guide is already in hand; caching it is an optimization.
  }
}

export interface UpgradeGuideOptions {
  /** Skip the network entirely; only an existing cache is used. */
  offline?: boolean;
  /** Injectable for tests. Defaults to `globalThis.fetch`. */
  fetchImpl?: typeof globalThis.fetch;
  /** Injectable clock, so cache expiry is testable without waiting a week. */
  now?: () => number;
  maxAgeMs?: number;
}

/**
 * The Upgrade Guide text for an installed Laravel major version, from cache when it is
 * fresh and from the network otherwise. Returns null when it cannot be obtained — offline,
 * a failed request, a non-200 — which the caller treats as "no doc-derived records", never
 * as an error.
 */
export async function loadLaravelUpgradeGuide(
  projectRoot: string,
  version: string,
  options: UpgradeGuideOptions = {},
): Promise<string | null> {
  const major = majorOf(version);
  const path = upgradeGuideCachePath(projectRoot, major);
  const now = (options.now ?? (() => Date.now()))();
  const maxAge = options.maxAgeMs ?? UPGRADE_GUIDE_MAX_AGE_MS;

  const cached = readCache(path, maxAge, now);
  if (cached !== null) {
    return cached;
  }
  if (options.offline === true) {
    // An expired cache still beats nothing when the network is off the table.
    return readCache(path, Number.POSITIVE_INFINITY, now);
  }

  const request = options.fetchImpl ?? globalThis.fetch;
  try {
    const response = await request(LARAVEL_UPGRADE_GUIDE_URL.replace('{major}', major), {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) {
      return readCache(path, Number.POSITIVE_INFINITY, now);
    }
    const body = await response.text();
    writeCache(path, body, now);
    return body;
  } catch {
    // Offline, DNS failure, timeout: fall back to any cache at all, then to nothing.
    return readCache(path, Number.POSITIVE_INFINITY, now);
  }
}

/**
 * The symbols an Upgrade Guide names under a deprecation or removal heading.
 *
 * Only `Class::method()` mentions are read, and only inside such a section: the guide is
 * prose, and a looser read would turn every code sample in it into a false deprecation.
 * Each record is `doc-derived`, so a consumer can weigh it differently from a declaration.
 */
export function parseUpgradeGuide(markdown: string, version: string): FrameworkApiSymbol[] {
  const records = new Map<string, FrameworkApiSymbol>();
  const major = majorOf(version);
  let heading = 'deprecations';
  let headingIsDeprecation = false;
  // Sticky within a section: the guide writes "The following have been removed:" once and
  // then lists the symbols, so the removal fact belongs to the section, not to each bullet.
  let sectionRemoval = false;

  const collect = (text: string, source: string, removal: boolean): void => {
    for (const match of text.matchAll(SYMBOL_PATTERN)) {
      const name = `${match[1] as string}::${match[2] as string}`;
      const existing = records.get(name);
      if (existing !== undefined) {
        // A later mention that says "removed" strengthens an earlier "deprecated".
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

/**
 * Fold doc-derived records into an already-built symbol list.
 *
 * The whole point of the backstop is the symbol Laravel deprecated in the guide and never
 * tagged in code, so a matching record that the adapter read as NOT deprecated is upgraded
 * to deprecated with `provenance: 'doc-derived'` — the guide is the framework team's
 * authoritative deprecation record, and an untagged declaration is silence, not a denial.
 * A record that already carries a real `@deprecated` tag keeps it: a declaration says more
 * than prose, so it is never overwritten. Symbols the declarations never saw at all are
 * appended.
 *
 * Matching is by last segment, so the guide's `Str::random` and the adapter's
 * `Illuminate\Support\Str::random` are one symbol, never two.
 */
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

/**
 * Apply the Upgrade Guide backstop to a built index, in place of a rebuild.
 *
 * Runs as a post-pass because the guide is fetched for the version the index RESOLVED, and
 * because it keeps the network out of the builder and the adapters entirely: everything
 * below this function stays synchronous and offline (INV-2). Returns how many records the
 * backstop changed, so the CLI can say so honestly rather than implying a check it skipped.
 */
export async function applyLaravelBackstop(
  projectRoot: string,
  index: { packages: { package: string; version: string; symbols: FrameworkApiSymbol[] }[] },
  options: UpgradeGuideOptions = {},
): Promise<{ applied: boolean; deprecations: number }> {
  const entry = index.packages.find((candidate) => candidate.package === 'laravel/framework');
  if (entry === undefined) {
    return { applied: false, deprecations: 0 };
  }
  const guide = await loadLaravelUpgradeGuide(projectRoot, entry.version, options);
  if (guide === null) {
    return { applied: false, deprecations: 0 };
  }
  const before = entry.symbols.filter((record) => record.deprecated).length;
  entry.symbols = mergeDocDerived(entry.symbols, parseUpgradeGuide(guide, entry.version));
  const after = entry.symbols.filter((record) => record.deprecated).length;
  return { applied: true, deprecations: after - before };
}
