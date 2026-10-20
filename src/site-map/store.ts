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

export function canonicalAppMapPath(projectRoot: string): string {
  return join(projectRoot, PATHS.SITE_MAP_CANONICAL_APP_MAP);
}

export function journeysDir(projectRoot: string): string {
  return join(projectRoot, PATHS.SITE_MAP_CANONICAL_JOURNEYS_DIR);
}

export function journeyPath(projectRoot: string, id: string): string {
  return join(journeysDir(projectRoot), `${id}${JOURNEY_SUFFIX}`);
}

export function writeYamlAtomic(target: string, data: unknown): string {
  mkdirSync(dirname(target), { recursive: true });
  const tmp = `${target}.tmp`;
  writeFileSync(tmp, YAML.stringify(data), 'utf8');
  renameSync(tmp, target);
  return target;
}

export function readYaml(target: string): unknown {
  try {
    return YAML.parse(readFileSync(target, 'utf8'));
  } catch {
    return null;
  }
}

export function writeCanonicalSiteMap(projectRoot: string, map: AppMap): string {
  const result = validateAppMap(map);
  if (!result.valid) {
    throw new SiteMapSchemaError('canonical app-map failed schema validation', result.errors);
  }
  return writeYamlAtomic(canonicalAppMapPath(projectRoot), map);
}

export function readCanonicalSiteMap(projectRoot: string): AppMap | null {
  const parsed = readYaml(canonicalAppMapPath(projectRoot));
  if (parsed === null) return null;
  return validateAppMap(parsed).valid ? (parsed as AppMap) : null;
}

export function writeJourney(projectRoot: string, journey: Journey): string {
  const result = validateJourney(journey);
  if (!result.valid) {
    throw new SiteMapSchemaError(`journey "${journey.id}" failed schema validation`, result.errors);
  }
  return writeYamlAtomic(journeyPath(projectRoot, journey.id), journey);
}

export function removeJourney(projectRoot: string, id: string): boolean {
  const target = journeyPath(projectRoot, id);
  if (!existsSync(target)) return false;
  rmSync(target, { force: true });
  return true;
}

function readJourneyAt(path: string): Journey | null {
  const parsed = readYaml(path);
  if (parsed === null) return null;
  return validateJourney(parsed).valid ? (parsed as Journey) : null;
}

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

export function readJourney(projectRoot: string, id: string): Journey | null {
  return readJourneyAt(journeyPath(projectRoot, id));
}

export function listJourneyIds(projectRoot: string): string[] {
  return listJourneyIdsIn(journeysDir(projectRoot));
}

export function readAllJourneys(projectRoot: string): Journey[] {
  return readAllJourneysIn(journeysDir(projectRoot));
}
