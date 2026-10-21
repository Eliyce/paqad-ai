import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';
import {
  FLAKY_REGISTRY_SCHEMA_VERSION,
  type FlakinessSmell,
  type FlakyRegistry,
  type FlakyRegistryEntry,
} from '@/core/types/flaky.js';

function registryPath(projectRoot: string): string {
  return join(projectRoot, PATHS.FLAKY_REGISTRY);
}

function emptyRegistry(now: string): FlakyRegistry {
  return {
    schema_version: FLAKY_REGISTRY_SCHEMA_VERSION,
    updated_at: now,
    entries: [],
  };
}

export function entryKey(testId: string, suite: string | null): string {
  return `${suite ?? ''}::${testId}`;
}

export async function readFlakyRegistry(
  projectRoot: string,
  now: string = new Date().toISOString(),
): Promise<FlakyRegistry> {
  let raw: string;
  try {
    raw = await readFile(registryPath(projectRoot), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return emptyRegistry(now);
    }
    throw error;
  }
  try {
    const parsed = JSON.parse(raw) as FlakyRegistry;
    if (!Array.isArray(parsed.entries)) {
      return emptyRegistry(now);
    }
    return parsed;
  } catch {
    /* v8 ignore start -- corrupt-JSON fallback is covered; the branch itself is defensive */
    return emptyRegistry(now);
  }
  /* v8 ignore stop */
}

export async function writeFlakyRegistry(
  projectRoot: string,
  registry: FlakyRegistry,
): Promise<string> {
  const targetPath = registryPath(projectRoot);
  await mkdir(dirname(targetPath), { recursive: true });

  const tempPath = `${targetPath}.tmp-${process.pid}-${Date.now()}`;
  const payload = `${JSON.stringify(registry, null, 2)}\n`;
  await writeFile(tempPath, payload, 'utf8');
  await rename(tempPath, targetPath);

  return targetPath;
}

export function activeQuarantines(registry: FlakyRegistry): FlakyRegistryEntry[] {
  return registry.entries.filter((entry) => entry.status === 'quarantined');
}

export interface QuarantineInput {
  test_id: string;
  suite: string | null;
  reruns: number;
  passes: number;
  failures: number;
  suspected_causes: FlakinessSmell[];
  modules: string[];
  now: string;
}

export function upsertQuarantine(registry: FlakyRegistry, input: QuarantineInput): FlakyRegistry {
  const key = entryKey(input.test_id, input.suite);
  const existing = registry.entries.find((e) => entryKey(e.test_id, e.suite) === key);

  const entry: FlakyRegistryEntry = {
    test_id: input.test_id,
    suite: input.suite,
    status: 'quarantined',
    first_seen: existing?.first_seen ?? input.now,
    updated_at: input.now,
    evidence: {
      reruns: input.reruns,
      passes: input.passes,
      failures: input.failures,
    },
    suspected_causes: input.suspected_causes,
    modules: input.modules,
  };

  const entries = existing
    ? registry.entries.map((e) => (entryKey(e.test_id, e.suite) === key ? entry : e))
    : [...registry.entries, entry];

  return { ...registry, updated_at: input.now, entries };
}

export function markCleared(
  registry: FlakyRegistry,
  testId: string,
  suite: string | null,
  reason: string,
  now: string,
): FlakyRegistry {
  const key = entryKey(testId, suite);
  let changed = false;
  const entries = registry.entries.map((e) => {
    if (entryKey(e.test_id, e.suite) !== key || e.status !== 'quarantined') {
      return e;
    }
    changed = true;
    return { ...e, status: 'cleared' as const, updated_at: now, cleared_reason: reason };
  });
  return changed ? { ...registry, updated_at: now, entries } : registry;
}
