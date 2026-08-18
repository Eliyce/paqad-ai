// Team-shared district curation store (issue #489, Phase 3). When someone drags a district on the
// interactive canvas, its arrangement is persisted here to `docs/site-map/layout.yaml` — a sibling
// of the canonical map, so a hand-arranged city plan rides PR diffs like the rest of the map family
// (the locked ux-pattern decision: team-shared, not a local file). Reads are tolerant: a missing,
// corrupt, or schema-invalid file reads as an empty layout (never a crash), so the canvas falls
// back to its computed layout. Writes validate before persisting and are atomic (temp + rename).

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import YAML from 'yaml';

import { PATHS } from '@/core/constants/paths.js';

/** One district's persisted placement. x/y is the authoritative position; w/h the drop-time size. */
export interface DistrictPlacement {
  x: number;
  y: number;
  w: number;
  h: number;
  color?: string;
  label?: string;
}

/** The stored layout: a placement per area id. */
export type SiteMapStoredLayout = Record<string, DistrictPlacement>;

const LAYOUT_VERSION = 1;

/** Thrown when a caller tries to persist a malformed layout. */
export class SiteMapLayoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SiteMapLayoutError';
  }
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Validate one placement, returning a clean copy or throwing with the offending area id. */
function cleanPlacement(areaId: string, raw: unknown): DistrictPlacement {
  if (typeof raw !== 'object' || raw === null) {
    throw new SiteMapLayoutError(`district "${areaId}" must be an object with x, y, w, h`);
  }
  const entry = raw as Record<string, unknown>;
  if (
    !isFiniteNumber(entry.x) ||
    !isFiniteNumber(entry.y) ||
    !isFiniteNumber(entry.w) ||
    !isFiniteNumber(entry.h)
  ) {
    throw new SiteMapLayoutError(`district "${areaId}" needs finite numeric x, y, w, h`);
  }
  const placement: DistrictPlacement = { x: entry.x, y: entry.y, w: entry.w, h: entry.h };
  if (typeof entry.color === 'string') placement.color = entry.color;
  if (typeof entry.label === 'string') placement.label = entry.label;
  return placement;
}

/** Validate a whole layout map (used by the write path and by tolerant reads). */
export function validateLayout(raw: unknown): SiteMapStoredLayout {
  if (typeof raw !== 'object' || raw === null) {
    throw new SiteMapLayoutError('layout must be a map of area id to placement');
  }
  const layout: SiteMapStoredLayout = {};
  for (const [areaId, value] of Object.entries(raw as Record<string, unknown>)) {
    layout[areaId] = cleanPlacement(areaId, value);
  }
  return layout;
}

/** Read the stored layout, or null when absent/corrupt/invalid (canvas then uses its own layout). */
export function readSiteMapLayout(projectRoot: string): SiteMapStoredLayout | null {
  const file = join(projectRoot, PATHS.SITE_MAP_CANONICAL_LAYOUT);
  if (!existsSync(file)) return null;
  try {
    const parsed = YAML.parse(readFileSync(file, 'utf8')) as { districts?: unknown } | null;
    if (parsed === null || typeof parsed !== 'object') return null;
    return validateLayout(parsed.districts ?? {});
  } catch {
    return null;
  }
}

/** Persist the layout atomically after validating it; throws on a malformed payload. */
export function writeSiteMapLayout(projectRoot: string, raw: unknown): SiteMapStoredLayout {
  const layout = validateLayout(raw);
  const file = join(projectRoot, PATHS.SITE_MAP_CANONICAL_LAYOUT);
  mkdirSync(dirname(file), { recursive: true });
  const body = YAML.stringify({ version: LAYOUT_VERSION, districts: layout });
  const temp = `${file}.tmp`;
  writeFileSync(temp, body, 'utf8');
  renameSync(temp, file);
  return layout;
}

/** Remove the stored layout so the canvas reverts to its computed arrangement (Reset layout). */
export function deleteSiteMapLayout(projectRoot: string): void {
  const file = join(projectRoot, PATHS.SITE_MAP_CANONICAL_LAYOUT);
  rmSync(file, { force: true });
}
