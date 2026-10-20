import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';

import { CAPABILITY_REGISTRY } from './registry.js';

export const CAPABILITY_LOCK_SCHEMA_VERSION = 1 as const;

export interface CapabilityLockEntry {
  digest: string;
  policy_version?: number;
  record_version?: number;
}

export interface CapabilityVersions {
  policy: number;
  record: number;
}

export interface CapabilityLock {
  schema_version: typeof CAPABILITY_LOCK_SCHEMA_VERSION;
  generated_at: string;
  capabilities: Record<string, CapabilityLockEntry>;
}

export function capabilityLockPath(projectRoot: string): string {
  return join(projectRoot, PATHS.CAPABILITY_LOCK);
}

export function readCapabilityLock(projectRoot: string): CapabilityLock | null {
  const path = capabilityLockPath(projectRoot);
  if (!existsSync(path)) {
    return null;
  }
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as CapabilityLock;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

export function readCapabilityDigest(projectRoot: string, capabilityId: string): string | null {
  const lock = readCapabilityLock(projectRoot);
  const entry = lock?.capabilities?.[capabilityId];
  return entry && typeof entry.digest === 'string' ? entry.digest : null;
}

export function readCapabilityVersions(
  projectRoot: string,
  capabilityId: string,
): CapabilityVersions | null {
  const entry = readCapabilityLock(projectRoot)?.capabilities?.[capabilityId];
  if (
    !entry ||
    typeof entry.policy_version !== 'number' ||
    typeof entry.record_version !== 'number'
  ) {
    return null;
  }
  return { policy: entry.policy_version, record: entry.record_version };
}

export function writeCapabilityDigest(
  projectRoot: string,
  capabilityId: string,
  digest: string,
  now: Date = new Date(),
): void {
  const existing = readCapabilityLock(projectRoot);
  const descriptor = CAPABILITY_REGISTRY.find((capability) => capability.id === capabilityId);
  const versions = descriptor
    ? {
        policy_version: descriptor.policySchemaVersion,
        record_version: descriptor.recordSchemaVersion,
      }
    : {};
  const lock: CapabilityLock = {
    schema_version: CAPABILITY_LOCK_SCHEMA_VERSION,
    generated_at: now.toISOString(),
    capabilities: {
      ...(existing?.capabilities ?? {}),
      [capabilityId]: { ...(existing?.capabilities?.[capabilityId] ?? {}), digest, ...versions },
    },
  };
  const path = capabilityLockPath(projectRoot);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(lock, null, 2)}\n`, 'utf8');
}
