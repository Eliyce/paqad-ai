// Issue #109 — persist / read the traceability map. The map is an artifact
// rebuilt from reality each run; it is never a hand-maintained source. Writes
// are atomic (temp + rename) and never throw on a corrupt read.

import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';
import type { TraceabilityMap } from '@/core/types/traceability.js';

export function traceabilityMapPath(projectRoot: string): string {
  return join(projectRoot, PATHS.TRACEABILITY_MAP);
}

/** Atomically writes the map to `.paqad/traceability/map.json`. */
export async function writeTraceabilityMap(
  projectRoot: string,
  map: TraceabilityMap,
): Promise<string> {
  const target = traceabilityMapPath(projectRoot);
  await mkdir(dirname(target), { recursive: true });
  const tmp = `${target}.tmp`;
  await writeFile(tmp, JSON.stringify(map, null, 2) + '\n', 'utf8');
  await rename(tmp, target);
  return target;
}

/** Reads the latest map, or null when absent / corrupt. */
export async function readTraceabilityMap(projectRoot: string): Promise<TraceabilityMap | null> {
  const target = traceabilityMapPath(projectRoot);
  if (!existsSync(target)) return null;
  try {
    return JSON.parse(await readFile(target, 'utf8')) as TraceabilityMap;
  } catch {
    return null;
  }
}
