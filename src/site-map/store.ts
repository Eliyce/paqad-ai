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
import type { SiteMapReportIndex } from '@/core/types/site-map-run.js';

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

export function journeysDir(projectRoot: string): string {
  return join(projectRoot, PATHS.SITE_MAP_JOURNEYS_DIR);
}

export function journeyPath(projectRoot: string, id: string): string {
  return join(journeysDir(projectRoot), `${id}${JOURNEY_SUFFIX}`);
}

/** Write a value atomically as YAML (temp file + rename). Returns the written path. */
function writeYamlAtomic(target: string, data: unknown): string {
  mkdirSync(dirname(target), { recursive: true });
  const tmp = `${target}.tmp`;
  writeFileSync(tmp, YAML.stringify(data), 'utf8');
  renameSync(tmp, target);
  return target;
}

/** Parse a YAML file into an object, or null when missing/corrupt. */
function readYaml(target: string): unknown {
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

/** Read the persisted app-map, or null when absent / corrupt / schema-invalid. */
export function readAppMap(projectRoot: string): AppMap | null {
  const parsed = readYaml(appMapPath(projectRoot));
  if (parsed === null) return null;
  return validateAppMap(parsed).valid ? (parsed as AppMap) : null;
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

/** Read one journey by id, or null when absent / corrupt / schema-invalid. */
export function readJourney(projectRoot: string, id: string): Journey | null {
  const parsed = readYaml(journeyPath(projectRoot, id));
  if (parsed === null) return null;
  return validateJourney(parsed).valid ? (parsed as Journey) : null;
}

/** List the journey ids present on disk (newest-file order not guaranteed; sorted). */
export function listJourneyIds(projectRoot: string): string[] {
  let names: string[];
  try {
    names = readdirSync(journeysDir(projectRoot));
  } catch {
    return [];
  }
  return names
    .filter((name) => name.endsWith(JOURNEY_SUFFIX))
    .map((name) => name.slice(0, -JOURNEY_SUFFIX.length))
    .sort();
}

/** Read every valid journey on disk, skipping any that fail validation. */
export function readAllJourneys(projectRoot: string): Journey[] {
  const journeys: Journey[] = [];
  for (const id of listJourneyIds(projectRoot)) {
    const journey = readJourney(projectRoot, id);
    if (journey !== null) {
      journeys.push(journey);
    }
  }
  return journeys;
}

/** Tolerant read of a run-report sidecar (`docs/site-map/<ts>.json`) — missing/corrupt is null. */
export function readSiteMapSidecar(path: string): SiteMapReportIndex | null {
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as SiteMapReportIndex;
    if (!Array.isArray(parsed.findings)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Find the newest `docs/site-map/*.json` sidecar (excluding retest sidecars) so
 * `sitemap retest` can default to the latest run. Returns an absolute path or null.
 */
export function findLatestSiteMapSidecar(projectRoot: string): string | null {
  const dir = join(projectRoot, PATHS.SITE_MAP_REPORT_DIR);
  if (!existsSync(dir)) return null;
  const candidates = readdirSync(dir)
    .filter((name) => name.endsWith('.json') && !name.includes('-retest-'))
    .sort();
  const latest = candidates.at(-1);
  return latest ? join(dir, latest) : null;
}
