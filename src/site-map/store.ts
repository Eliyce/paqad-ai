// Persisted site-map store. The canonical map (`app-map.yaml`) and each per-journey YAML
// are written atomically (temp file + rename) and validated BEFORE they are persisted, so
// a schema-invalid artifact is never stored (INV-3). Reads are tolerant: a missing,
// corrupt, or schema-invalid file reads as absent (null), never a crash and never a
// half-built map masquerading as real (mirrors the code-knowledge store discipline).

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';

import YAML from 'yaml';

import { PATHS } from '@/core/constants/paths.js';
import type { AppMap, Journey } from '@/core/types/site-map.js';

import { validateAppMap, validateJourney } from './schema.js';

/** Thrown when a caller tries to persist a schema-invalid artifact (INV-3). */
export class SiteMapSchemaError extends Error {
  constructor(
    message: string,
    readonly errors: string[],
  ) {
    super(message);
    this.name = 'SiteMapSchemaError';
  }
}

const JOURNEY_SUFFIX = '.journey.yaml';

export function appMapPath(projectRoot: string): string {
  return join(projectRoot, PATHS.SITE_MAP_APP_MAP);
}

/**
 * The single canonical, AI-authored map location (issue #466). Lives under `docs/site-map/`,
 * outside the auto-loaded instructions tree, and is what the dashboard renders statically.
 */
export function canonicalAppMapPath(projectRoot: string): string {
  return join(projectRoot, PATHS.SITE_MAP_CANONICAL_APP_MAP);
}

export function journeysDir(projectRoot: string): string {
  return join(projectRoot, PATHS.SITE_MAP_JOURNEYS_DIR);
}

/** The canonical journeys directory (issue #466), sibling of the canonical app-map. */
export function canonicalJourneysDir(projectRoot: string): string {
  return join(projectRoot, PATHS.SITE_MAP_CANONICAL_JOURNEYS_DIR);
}

export function journeyPath(projectRoot: string, id: string): string {
  return join(journeysDir(projectRoot), `${id}${JOURNEY_SUFFIX}`);
}

/**
 * Write a value atomically as YAML (temp file + rename). Returns the written path. Exported so
 * sibling site-map stores (for example the creation-answers store, issue #466) reuse this exact
 * atomic-write discipline instead of copying it.
 */
export function writeYamlAtomic(target: string, data: unknown): string {
  mkdirSync(dirname(target), { recursive: true });
  const tmp = `${target}.tmp`;
  writeFileSync(tmp, YAML.stringify(data), 'utf8');
  renameSync(tmp, target);
  return target;
}

/**
 * Parse a YAML file into an object, or null when missing/corrupt. Exported so sibling site-map
 * stores reuse the same tolerant read (a missing or corrupt file reads as absent, never a crash).
 */
export function readYaml(target: string): unknown {
  try {
    // Read directly (no existsSync-then-read race); a missing file throws ENOENT and reads
    // as absent, exactly like a corrupt one.
    return YAML.parse(readFileSync(target, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Persist the canonical app-map atomically, after validating it. Throws
 * {@link SiteMapSchemaError} on an invalid map so a bad shape is never written.
 */
export function writeAppMap(projectRoot: string, map: AppMap): string {
  const result = validateAppMap(map);
  if (!result.valid) {
    throw new SiteMapSchemaError('app-map failed schema validation', result.errors);
  }
  return writeYamlAtomic(appMapPath(projectRoot), map);
}

/**
 * Persist the canonical, AI-authored map (issue #466) to `docs/site-map/app-map.yaml`
 * atomically, after validating it. This is the single writer of the location the dashboard
 * renders and the write side of the trust proof stamps into (see `stampHonestTrustTiers`).
 * Throws {@link SiteMapSchemaError} on an invalid map so a bad shape is never written.
 */
export function writeCanonicalSiteMap(projectRoot: string, map: AppMap): string {
  const result = validateAppMap(map);
  if (!result.valid) {
    throw new SiteMapSchemaError('canonical app-map failed schema validation', result.errors);
  }
  return writeYamlAtomic(canonicalAppMapPath(projectRoot), map);
}

/** Read an app-map from an explicit path, or null when absent / corrupt / schema-invalid. */
function readAppMapAt(path: string): AppMap | null {
  const parsed = readYaml(path);
  if (parsed === null) return null;
  return validateAppMap(parsed).valid ? (parsed as AppMap) : null;
}

/** Read the persisted app-map, or null when absent / corrupt / schema-invalid. */
export function readAppMap(projectRoot: string): AppMap | null {
  return readAppMapAt(appMapPath(projectRoot));
}

/**
 * Read the single canonical, AI-authored map (issue #466) from `docs/site-map/app-map.yaml`,
 * or null when absent / corrupt / schema-invalid. This is the static source the dashboard
 * renders — no LLM at view time (NFR-4).
 */
export function readCanonicalSiteMap(projectRoot: string): AppMap | null {
  return readAppMapAt(canonicalAppMapPath(projectRoot));
}

/**
 * Persist a journey atomically, after validating it. Throws {@link SiteMapSchemaError} on
 * an invalid journey. The filename is derived from the journey id.
 */
export function writeJourney(projectRoot: string, journey: Journey): string {
  const result = validateJourney(journey);
  if (!result.valid) {
    throw new SiteMapSchemaError(`journey "${journey.id}" failed schema validation`, result.errors);
  }
  return writeYamlAtomic(journeyPath(projectRoot, journey.id), journey);
}

/** Remove a journey file by id. Returns true when a file was deleted, false when none existed. */
export function removeJourney(projectRoot: string, id: string): boolean {
  const target = journeyPath(projectRoot, id);
  if (!existsSync(target)) return false;
  rmSync(target, { force: true });
  return true;
}

/** Read one journey file from an explicit path, or null when absent / corrupt / schema-invalid. */
function readJourneyAt(path: string): Journey | null {
  const parsed = readYaml(path);
  if (parsed === null) return null;
  return validateJourney(parsed).valid ? (parsed as Journey) : null;
}

/** List the journey ids present in a directory (sorted; empty when the directory is absent). */
function listJourneyIdsIn(dir: string): string[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  return names
    .filter((name) => name.endsWith(JOURNEY_SUFFIX))
    .map((name) => name.slice(0, -JOURNEY_SUFFIX.length))
    .sort();
}

/** Read every valid journey in a directory, skipping any that fail validation. */
function readAllJourneysIn(dir: string): Journey[] {
  const journeys: Journey[] = [];
  for (const id of listJourneyIdsIn(dir)) {
    const journey = readJourneyAt(join(dir, `${id}${JOURNEY_SUFFIX}`));
    if (journey !== null) {
      journeys.push(journey);
    }
  }
  return journeys;
}

/** Read one journey by id, or null when absent / corrupt / schema-invalid. */
export function readJourney(projectRoot: string, id: string): Journey | null {
  return readJourneyAt(journeyPath(projectRoot, id));
}

/** List the journey ids present on disk (newest-file order not guaranteed; sorted). */
export function listJourneyIds(projectRoot: string): string[] {
  return listJourneyIdsIn(journeysDir(projectRoot));
}

/** Read every valid journey on disk, skipping any that fail validation. */
export function readAllJourneys(projectRoot: string): Journey[] {
  return readAllJourneysIn(journeysDir(projectRoot));
}

/**
 * Read every valid journey from the canonical location (issue #466), skipping any that fail
 * validation. These carry the per-step detail journey mode renders (DATA-2).
 */
export function readAllCanonicalJourneys(projectRoot: string): Journey[] {
  return readAllJourneysIn(canonicalJourneysDir(projectRoot));
}

