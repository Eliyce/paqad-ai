import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import YAML from 'yaml';

import { PATHS } from '@/core/constants/paths.js';

export interface DistrictPlacement {
  x: number;
  y: number;
  w: number;
  h: number;
  color?: string;
  label?: string;
}

export type SiteMapStoredLayout = Record<string, DistrictPlacement>;

const LAYOUT_VERSION = 1;

export class SiteMapLayoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SiteMapLayoutError';
  }
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

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

const AREA_ID_RE = /^[a-z0-9][a-z0-9_-]*$/i;
const UNSAFE_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

export function validateLayout(raw: unknown): SiteMapStoredLayout {
  if (typeof raw !== 'object' || raw === null) {
    throw new SiteMapLayoutError('layout must be a map of area id to placement');
  }
  const entries: [string, DistrictPlacement][] = [];
  for (const [areaId, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!AREA_ID_RE.test(areaId) || UNSAFE_KEYS.has(areaId)) {
      throw new SiteMapLayoutError(`district id "${areaId}" is not allowed`);
    }
    entries.push([areaId, cleanPlacement(areaId, value)]);
  }
  return Object.assign(
    Object.create(null) as SiteMapStoredLayout,
    Object.fromEntries(entries),
  ) as SiteMapStoredLayout;
}

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

export function deleteSiteMapLayout(projectRoot: string): void {
  const file = join(projectRoot, PATHS.SITE_MAP_CANONICAL_LAYOUT);
  rmSync(file, { force: true });
}
