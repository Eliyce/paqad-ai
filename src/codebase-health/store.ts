import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';
import type { HealthReportIndex } from '@/core/types/codebase-health.js';

export function readHealthSidecar(path: string): HealthReportIndex | null {
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as HealthReportIndex;
    if (!Array.isArray(parsed.findings)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function findLatestSidecar(projectRoot: string): string | null {
  const dir = join(projectRoot, PATHS.HEALTH_DIR);
  if (!existsSync(dir)) return null;
  const candidates = readdirSync(dir)
    .filter((name) => name.endsWith('.json') && !name.includes('-retest-'))
    .sort();
  const latest = candidates.at(-1);
  return latest ? join(dir, latest) : null;
}
