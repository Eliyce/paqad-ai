import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';
import type { TraceabilityMap } from '@/core/types/traceability.js';

export function traceabilityMapPath(projectRoot: string): string {
  return join(projectRoot, PATHS.TRACEABILITY_MAP);
}

export async function writeTraceabilityMap(
  projectRoot: string,
  map: TraceabilityMap,
): Promise<string> {
  const target = traceabilityMapPath(projectRoot);
  await mkdir(dirname(target), { recursive: true });
  const tmp = `${target}.tmp-${process.pid}-${randomBytes(6).toString('hex')}`;
  try {
    await writeFile(tmp, JSON.stringify(map, null, 2) + '\n', 'utf8');
    await rename(tmp, target);
  } catch (error) {
    await rm(tmp, { force: true });
    throw error;
  }
  return target;
}

export async function readTraceabilityMap(projectRoot: string): Promise<TraceabilityMap | null> {
  const target = traceabilityMapPath(projectRoot);
  if (!existsSync(target)) return null;
  try {
    return JSON.parse(await readFile(target, 'utf8')) as TraceabilityMap;
  } catch {
    return null;
  }
}
