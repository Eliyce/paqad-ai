import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import fg from 'fast-glob';

import { HEALTH_TIERS } from '@/core/constants/planning.js';
import { PATHS } from '@/core/constants/paths.js';
import type {
  HealthTier,
  ModuleHealthMetrics,
  ModuleHealthProfile,
} from '@/core/types/planning.js';

export function deriveHealthTier(metrics: ModuleHealthMetrics): HealthTier {
  const coverage = metrics.coverage_pct ?? null;
  const defectFrequency = metrics.defect_frequency ?? null;
  const contractStability = metrics.contract_stability ?? null;

  if (coverage === null && defectFrequency === null && contractStability === null) {
    return HEALTH_TIERS.UNKNOWN;
  }

  if (
    coverage !== null &&
    coverage >= 80 &&
    defectFrequency !== null &&
    defectFrequency <= 2 &&
    contractStability !== null &&
    contractStability >= 0.85
  ) {
    return HEALTH_TIERS.STABLE;
  }

  if (coverage !== null && coverage >= 50 && defectFrequency !== null && defectFrequency <= 5) {
    return HEALTH_TIERS.MODERATE;
  }

  return HEALTH_TIERS.FRAGILE;
}

export async function readModuleHealth(
  root: string,
  moduleName: string,
): Promise<ModuleHealthProfile | null> {
  try {
    const raw = await readFile(moduleHealthPath(root, moduleName), 'utf8');
    return JSON.parse(raw) as ModuleHealthProfile;
  } catch {
    return null;
  }
}

export async function writeModuleHealth(
  root: string,
  moduleName: string,
  metrics: ModuleHealthMetrics,
): Promise<ModuleHealthProfile> {
  const profile: ModuleHealthProfile = {
    module: moduleName,
    tier: deriveHealthTier(metrics),
    metrics,
    updated_at: new Date().toISOString(),
  };
  await writeModuleHealthProfile(root, profile);
  return profile;
}

export async function writeModuleHealthProfile(
  root: string,
  profile: ModuleHealthProfile,
): Promise<ModuleHealthProfile> {
  const path = moduleHealthPath(root, profile.module);
  await mkdir(dirname(path), { recursive: true });
  const content = JSON.stringify(profile, null, 2) + '\n';
  JSON.parse(content);
  const temporaryPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporaryPath, content, 'utf8');
  await rename(temporaryPath, path);
  return profile;
}

export async function readAllModuleHealth(root: string): Promise<ModuleHealthProfile[]> {
  const dir = join(root, PATHS.PLANNING_MODULE_HEALTH_DIR);
  try {
    const files = await fg('**/*.json', { cwd: dir, onlyFiles: true });
    const profiles = await Promise.all(
      files
        .filter((file) => !file.split('/').includes('evidence'))
        .map(async (file) => {
          const raw = await readFile(join(dir, file), 'utf8');
          return JSON.parse(raw) as ModuleHealthProfile;
        }),
    );
    return profiles
      .filter(isModuleHealthProfile)
      .sort((left, right) => left.module.localeCompare(right.module));
  } catch {
    return [];
  }
}

export async function initializeModuleHealth(
  root: string,
  moduleName: string,
): Promise<ModuleHealthProfile> {
  const existing = await readModuleHealth(root, moduleName);
  if (existing) {
    return existing;
  }

  return writeModuleHealth(root, moduleName, {
    coverage_pct: null,
    defect_frequency: null,
    contract_stability: null,
    change_velocity: null,
  });
}

export function moduleHealthPath(root: string, moduleName: string): string {
  return join(root, PATHS.PLANNING_MODULE_HEALTH_DIR, `${moduleName}.json`);
}

function isModuleHealthProfile(value: ModuleHealthProfile): value is ModuleHealthProfile {
  return (
    typeof value.module === 'string' &&
    typeof value.tier === 'string' &&
    typeof value.metrics === 'object' &&
    value.metrics !== null &&
    typeof value.updated_at === 'string'
  );
}
