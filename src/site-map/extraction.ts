// Surface extraction — the S1 (`extraction`) stage of the site-map workflow. Pure detectors
// that turn already-gathered, normalized inputs into RAW surfaces: the deterministic material
// the modeling stage (S2, LLM) later names, slugs, and attributes. Mirrors codebase-health's
// `detectors.ts` — no I/O, no shell, no network — so every branch is exercised with fixtures;
// the impure gathering (reading the commander program, walking the tree) lives in the gatherer.
//
// FR-2: extraction is deterministic and injectable (zero model tokens). FR-3: an unavailable
// extractor is recorded as a blocked check and the run proceeds — a blocked check is a gap,
// never a silent pass. See docs/specs/site-map-capability.plan.md §II.3 (S1) and §II.4.

import { createHash } from 'node:crypto';

import { slugify } from '@/pentest/shared.js';
import type { SiteMapBlockedCheck } from '@/core/types/site-map-run.js';
import type {
  AppKind,
  Confidence,
  Evidence,
  SurfaceEntry,
  SurfaceKind,
} from '@/core/types/site-map.js';

/** Bumped when the in-memory extraction shape changes; independent of the map schema version. */
export const SITE_MAP_EXTRACTION_SCHEMA_VERSION = 1;

const NODE_CLI_SOURCE = 'node-cli';
const GENERIC_SOURCE = 'generic';

/** One commander command as read from the CLI program (normalized by the gatherer). */
export interface CliCommandRecord {
  /** Space-joined command path, e.g. `sitemap` or `plan compile`. */
  name: string;
  description?: string;
  /** Where the command is registered. */
  file: string;
  line?: number;
  /** commander `.hidden()` commands are internal plumbing, not user-facing surfaces. */
  hidden?: boolean;
}

/** A raw surface entry from the generic fallback (any stack the gatherer can enumerate). */
export interface GenericSurfaceRecord {
  kind: SurfaceKind;
  /** Raw identifier: a route path, url, screen name, etc. */
  identifier: string;
  label?: string;
  file: string;
  line?: number;
  entry?: SurfaceEntry;
}

/** A raw surface produced by extraction — deterministic material for the modeling stage. */
export interface ExtractedSurface {
  /** Stable, slug-shaped id derived from the raw identifier (the modeling stage refines it). */
  raw_id: string;
  kind: SurfaceKind;
  label: string;
  evidence: Evidence[];
  entry?: SurfaceEntry;
  /** Extraction is always static/deterministic. */
  derivation: 'static';
  confidence: Confidence;
  /** Which extractor produced it, e.g. `node-cli` or `generic`. */
  source: string;
}

/** One extractor's contribution to a run: its surfaces, or a blocked check when unavailable. */
export interface ExtractorOutput {
  extractor: string;
  available: boolean;
  surfaces: ExtractedSurface[];
  /** Populated when `available` is false: why it could not run and how to enable it. */
  blocked?: SiteMapBlockedCheck | null;
}

/** The merged, fingerprinted result of the extraction stage (the `extraction.json` shape). */
export interface ExtractionResult {
  schema_version: number;
  app_kind: AppKind;
  surfaces: ExtractedSurface[];
  blocked_checks: SiteMapBlockedCheck[];
  /** Content-addressed over the raw surface set — the drift signal for the freshness gate. */
  fingerprint: string;
  /** How many extractors actually ran (available === true). */
  extractors_ran: number;
  /** True when NO extractor ran: any downstream surfaces are an agent-led, low-confidence fallback. */
  low_confidence_fallback: boolean;
}

/** `file:line` evidence, omitting `line` when the gatherer could not pin one. */
function toEvidence(file: string, line?: number): Evidence {
  return line === undefined ? { file } : { file, line };
}

/** A slug-shaped raw id: `<source>-<slug>`, or just `<source>` when the identifier has no word chars. */
function toRawId(source: string, identifier: string): string {
  const slug = slugify(identifier);
  return slug.length > 0 ? `${source}-${slug}` : source;
}

/**
 * Node-CLI extractor: each non-hidden commander command becomes a `cli-command` surface whose
 * entry is the binary invocation. Hidden commands are internal plumbing, never a surface.
 */
export function extractNodeCliSurfaces(records: CliCommandRecord[]): ExtractedSurface[] {
  const surfaces: ExtractedSurface[] = [];
  for (const record of records) {
    if (record.hidden) continue;
    const description = record.description?.trim();
    surfaces.push({
      raw_id: toRawId(NODE_CLI_SOURCE, record.name),
      kind: 'cli-command',
      label: description && description.length > 0 ? description : record.name,
      evidence: [toEvidence(record.file, record.line)],
      entry: { kind: 'bin', value: record.name },
      derivation: 'static',
      confidence: 'high',
      source: NODE_CLI_SOURCE,
    });
  }
  return surfaces;
}

/**
 * Generic fallback extractor: for stacks without a dedicated extractor, the gatherer hands over
 * already-enumerated raw entries. We trust their kind but flag the whole set `medium` confidence
 * — a convention-based read, not a first-class extractor.
 */
export function extractGenericSurfaces(records: GenericSurfaceRecord[]): ExtractedSurface[] {
  return records.map((record) => {
    const label = record.label?.trim();
    return {
      raw_id: toRawId(GENERIC_SOURCE, record.identifier),
      kind: record.kind,
      label: label && label.length > 0 ? label : record.identifier,
      evidence: [toEvidence(record.file, record.line)],
      ...(record.entry ? { entry: record.entry } : {}),
      derivation: 'static' as const,
      confidence: 'medium' as const,
      source: GENERIC_SOURCE,
    };
  });
}

/** Merge two evidence lists, dropping exact `file:line:note` duplicates (stable order). */
function mergeEvidence(a: Evidence[], b: Evidence[]): Evidence[] {
  const seen = new Set<string>();
  const merged: Evidence[] = [];
  for (const evidence of [...a, ...b]) {
    const key = `${evidence.file}:${evidence.line ?? ''}:${evidence.note ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(evidence);
  }
  return merged;
}

/** Collapse surfaces sharing a `raw_id` (first wins, evidence unioned) without mutating inputs. */
function dedupeSurfaces(surfaces: ExtractedSurface[]): ExtractedSurface[] {
  const byId = new Map<string, ExtractedSurface>();
  for (const surface of surfaces) {
    const existing = byId.get(surface.raw_id);
    if (!existing) {
      byId.set(surface.raw_id, { ...surface, evidence: [...surface.evidence] });
      continue;
    }
    existing.evidence = mergeEvidence(existing.evidence, surface.evidence);
  }
  return [...byId.values()];
}

/** Order surfaces deterministically by `raw_id` so runs and fingerprints are reproducible. */
export function sortExtractedSurfaces(surfaces: ExtractedSurface[]): ExtractedSurface[] {
  return [...surfaces].sort((a, b) => a.raw_id.localeCompare(b.raw_id));
}

/**
 * Content-addressed fingerprint over the raw surface set (id + kind + evidence), order-
 * independent so a re-run over the same code yields the same digest. This is the drift signal
 * the freshness gate compares against the map's recorded baseline (zero unexplained drift).
 */
export function extractionFingerprint(surfaces: ExtractedSurface[]): string {
  const payload = JSON.stringify(
    [...surfaces]
      .map((surface) => ({
        raw_id: surface.raw_id,
        kind: surface.kind,
        evidence: surface.evidence,
      }))
      .sort((a, b) => a.raw_id.localeCompare(b.raw_id)),
  );
  // SHA-256 (not for security — a stable content-addressed drift key; only already-safe map
  // metadata reaches here).
  return createHash('sha256').update(payload).digest('hex').slice(0, 12);
}

/** Build a blocked-extractor output: it ran nothing, and records why plus how to enable it (FR-3). */
export function blockedExtractor(
  extractor: string,
  reason: string,
  installHint: string,
): ExtractorOutput {
  return {
    extractor,
    available: false,
    surfaces: [],
    blocked: { check: `${extractor} surface extraction`, reason, install_hint: installHint },
  };
}

/**
 * Merge every extractor's output into the fingerprinted `extraction.json` shape: available
 * extractors contribute surfaces (deduped and sorted), unavailable ones contribute blocked
 * checks, and the run proceeds either way. `low_confidence_fallback` is true when nothing ran.
 */
export function assembleExtraction(outputs: ExtractorOutput[], appKind: AppKind): ExtractionResult {
  const surfaces = sortExtractedSurfaces(
    dedupeSurfaces(
      outputs.filter((output) => output.available).flatMap((output) => output.surfaces),
    ),
  );
  const blockedChecks = outputs.flatMap((output) =>
    !output.available && output.blocked ? [output.blocked] : [],
  );
  const extractorsRan = outputs.filter((output) => output.available).length;
  return {
    schema_version: SITE_MAP_EXTRACTION_SCHEMA_VERSION,
    app_kind: appKind,
    surfaces,
    blocked_checks: blockedChecks,
    fingerprint: extractionFingerprint(surfaces),
    extractors_ran: extractorsRan,
    low_confidence_fallback: extractorsRan === 0,
  };
}
