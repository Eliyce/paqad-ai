import { join } from 'node:path';

import type { StackSnapshot } from '@/core/types/introspection.js';

import { atomicWriteJson, readJsonFile } from './files.js';
import { RULES_DISCOVERY_BASELINE, STACK_SNAPSHOT_PATH, runFilePath } from './paths.js';
import type { BaselinePackage, RulesDiscoveryBaseline, StackInventory } from './types.js';

export function readBaseline(projectRoot: string): RulesDiscoveryBaseline | null {
  const read = readJsonFile<RulesDiscoveryBaseline>(join(projectRoot, RULES_DISCOVERY_BASELINE));
  if (read.state !== 'ok' || !Array.isArray(read.value.packages)) {
    return null;
  }
  return read.value;
}

export function baselineLabel(baseline: RulesDiscoveryBaseline): string {
  return baseline.inventory ?? baseline.seeded_from ?? RULES_DISCOVERY_BASELINE;
}

export function seedBaselineFromSnapshot(
  projectRoot: string,
  now: Date = new Date(),
): RulesDiscoveryBaseline | null {
  const snapshot = readJsonFile<StackSnapshot>(join(projectRoot, STACK_SNAPSHOT_PATH));
  if (snapshot.state !== 'ok' || !Array.isArray(snapshot.value.packages)) {
    return null;
  }
  const baseline: RulesDiscoveryBaseline = {
    schema_version: 1,
    source: 'seed',
    inventory: null,
    run_id: null,
    seeded_from: STACK_SNAPSHOT_PATH,
    updated_at: now.toISOString(),
    packages: snapshot.value.packages.map((pkg) => ({
      name: pkg.name,
      ecosystem: pkg.ecosystem,
      declared: knownVersion(pkg.version_constraint),
      installed: knownVersion(pkg.locked_version),
      dev: pkg.is_dev,
    })),
  };
  atomicWriteJson(join(projectRoot, RULES_DISCOVERY_BASELINE), baseline);
  return baseline;
}

export function readOrSeedBaseline(
  projectRoot: string,
  now: Date = new Date(),
): RulesDiscoveryBaseline | null {
  return readBaseline(projectRoot) ?? seedBaselineFromSnapshot(projectRoot, now);
}

export function moveBaselineToRun(
  projectRoot: string,
  inventory: StackInventory,
  now: Date = new Date(),
): RulesDiscoveryBaseline {
  const baseline: RulesDiscoveryBaseline = {
    schema_version: 1,
    source: 'run',
    inventory: runFilePath(inventory.run_id, 'inventory'),
    run_id: inventory.run_id,
    seeded_from: null,
    updated_at: now.toISOString(),
    packages: inventory.packages
      .filter((pkg) => pkg.status !== 'removed')
      .map((pkg): BaselinePackage => ({
        name: pkg.name,
        ecosystem: pkg.ecosystem,
        declared: pkg.declared,
        installed: pkg.installed,
        dev: pkg.dev,
      })),
  };
  atomicWriteJson(join(projectRoot, RULES_DISCOVERY_BASELINE), baseline);
  return baseline;
}

export function knownVersion(value: string | undefined | null): string | null {
  return value === undefined || value === null || value === '' || value === 'unknown'
    ? null
    : value;
}
