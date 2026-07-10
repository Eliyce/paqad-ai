import { access, mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';

import YAML from 'yaml';

import { PATHS } from '@/core/constants/paths.js';
import type { PlanningManifest } from '@/core/types/planning.js';

export async function loadManifest(root: string, slug: string): Promise<PlanningManifest> {
  const raw = await readFile(join(root, PATHS.PLANNING_MANIFESTS_DIR, `${slug}.yaml`), 'utf8');
  return YAML.parse(raw) as PlanningManifest;
}

export async function saveManifest(root: string, manifest: PlanningManifest): Promise<string> {
  const target = join(root, PATHS.PLANNING_MANIFESTS_DIR, `${manifest.slug}.yaml`);
  const temp = `${target}.tmp`;
  await mkdir(dirname(target), { recursive: true });
  await writeFile(temp, YAML.stringify(manifest), 'utf8');
  await rename(temp, target);
  return target;
}

export async function manifestExists(root: string, slug: string): Promise<boolean> {
  try {
    await access(join(root, PATHS.PLANNING_MANIFESTS_DIR, `${slug}.yaml`));
    return true;
  } catch {
    return false;
  }
}

export async function listManifestSlugs(root: string): Promise<string[]> {
  try {
    const files = await readdir(join(root, PATHS.PLANNING_MANIFESTS_DIR));
    return files
      .filter((file) => file.endsWith('.yaml'))
      .map((file) => file.slice(0, -'.yaml'.length))
      .sort();
  } catch {
    return [];
  }
}

export function computeManifestHash(manifest: PlanningManifest): string {
  const canonical = stableStringify(manifest);
  return `sha256:${createHash('sha256').update(canonical).digest('hex')}`;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(',')}]`;
  }

  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
      left.localeCompare(right),
    );
    return `{${entries
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
      .join(',')}}`;
  }

  return JSON.stringify(value);
}
