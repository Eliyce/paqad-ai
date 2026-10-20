import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, posix } from 'node:path';

import type { AnalyticsCallSite } from './call-sites.js';
import { findProvider, type AnalyticsProviderId } from './providers.js';

export function analyticsFeatureDir(module: string, feature: string): string {
  return posix.join('docs', 'modules', module, 'analytics', feature);
}

export function analyticsIndexPath(module: string): string {
  return posix.join('docs', 'modules', module, 'analytics', 'index.md');
}

export function normalizeEventSlug(eventName: string): string {
  return eventName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-/, '')
    .replace(/-$/, '');
}

export function analyticsEventDocPath(module: string, feature: string, eventName: string): string {
  return posix.join(analyticsFeatureDir(module, feature), `${normalizeEventSlug(eventName)}.md`);
}

export interface EventGroup {
  slug: string;
  variants: string[];
  providers: AnalyticsProviderId[];
}

export function groupBySlug(callSites: readonly AnalyticsCallSite[]): EventGroup[] {
  const bySlug = new Map<string, { variants: Set<string>; providers: Set<AnalyticsProviderId> }>();
  for (const site of callSites) {
    const slug = normalizeEventSlug(site.eventName);
    if (slug === '') continue;
    const entry = bySlug.get(slug) ?? { variants: new Set(), providers: new Set() };
    entry.variants.add(site.eventName);
    entry.providers.add(site.provider);
    bySlug.set(slug, entry);
  }
  return [...bySlug.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([slug, entry]) => ({
      slug,
      variants: [...entry.variants].sort(),
      providers: [...entry.providers].sort(),
    }));
}

function providerDisplay(id: AnalyticsProviderId): string {
  /* v8 ignore next -- a call-site provider id always resolves; the `?? id` is defensive */
  return findProvider(id)?.displayName ?? id;
}

export function buildEventDoc(input: {
  module: string;
  feature: string;
  group: EventGroup;
}): string {
  const { module, feature, group } = input;
  const canonical = group.variants[0]!;
  const conflictNote =
    group.variants.length > 1
      ? `\n> ⚠️ Casing conflict — these spellings collapse to one event and must be reconciled to a single string: ${group.variants
          .map((v) => `\`${v}\``)
          .join(', ')}.\n`
      : '';
  const providerSections = group.providers
    .map(
      (id) =>
        `### ${providerDisplay(id)}\n\nFired via ${providerDisplay(id)} (\`${id}\`). Event string: \`${canonical}\`.\n`,
    )
    .join('\n');
  return `# Event: \`${canonical}\`
${conflictNote}
- Module: \`${module}\`
- Feature: \`${feature}\`
- Slug: \`${group.slug}\`

## What it means

_Describe when this event fires and why it exists (the business question it answers)._

## Providers

${providerSections}
## Properties

_Document the event's properties and their types._

## PII / consent

_Does this event or any property carry personal data? If so, it must pass an
\`analytics.pii_consent\` decision. This is review-time governance, not redaction at capture._
`;
}

export function buildAnalyticsIndex(input: {
  module: string;
  entries: { feature: string; group: EventGroup }[];
}): string {
  const { module, entries } = input;
  const rows =
    entries.length === 0
      ? '_No analytics events documented for this module yet._'
      : entries
          .slice()
          .sort(
            (a, b) =>
              a.feature.localeCompare(b.feature) || a.group.slug.localeCompare(b.group.slug),
          )
          .map(({ feature, group }) => {
            const rel = `${feature}/${group.slug}.md`;
            return `| \`${group.variants[0]}\` | \`${feature}\` | ${group.providers
              .map((p) => providerDisplay(p))
              .join(', ')} | [doc](${rel}) |`;
          })
          .join('\n');
  return `# Analytics events — \`${module}\`

The tracking plan for this module. Each row is one event with its own reviewed, versioned doc.
Read this before adding a new event so you reuse an existing one rather than coining a duplicate.

| Event | Feature | Providers | Doc |
| --- | --- | --- | --- |
${rows}
`;
}

export interface AnalyticsSyncEntry {
  module: string;
  feature: string;
  callSites: AnalyticsCallSite[];
}

export interface AnalyticsSyncResult {
  written: string[];
  skipped: string[];
  conflicts: { path: string; variants: string[] }[];
}

export async function syncAnalyticsDocs(
  projectRoot: string,
  entries: readonly AnalyticsSyncEntry[],
): Promise<AnalyticsSyncResult> {
  const result: AnalyticsSyncResult = { written: [], skipped: [], conflicts: [] };
  const indexByModule = new Map<string, { feature: string; group: EventGroup }[]>();

  for (const entry of entries) {
    for (const group of groupBySlug(entry.callSites)) {
      const rel = posix.join(analyticsFeatureDir(entry.module, entry.feature), `${group.slug}.md`);
      await writeIfChanged(projectRoot, rel, buildEventDoc({ ...entry, group }), result);
      if (group.variants.length > 1) {
        result.conflicts.push({ path: rel, variants: group.variants });
      }
      const bucket = indexByModule.get(entry.module) ?? [];
      bucket.push({ feature: entry.feature, group });
      indexByModule.set(entry.module, bucket);
    }
  }

  for (const [module, indexEntries] of indexByModule) {
    const rel = analyticsIndexPath(module);
    await writeIfChanged(
      projectRoot,
      rel,
      buildAnalyticsIndex({ module, entries: indexEntries }),
      result,
    );
  }

  return result;
}

async function writeIfChanged(
  projectRoot: string,
  relPath: string,
  content: string,
  result: AnalyticsSyncResult,
): Promise<void> {
  const abs = join(projectRoot, relPath);
  let existing: string | null;
  try {
    existing = await readFile(abs, 'utf8');
  } catch {
    existing = null;
  }
  if (existing === content) {
    result.skipped.push(relPath);
    return;
  }
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, content, 'utf8');
  result.written.push(relPath);
}
