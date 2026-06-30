// The Capability Kernel integrity lock (buildout F5 — decision D1, audit).
//
// `capability-lock.json` is the engine-owned, tracked record of each capability's
// BLESSED state. The engine writes a digest here whenever it produces that state
// through its own single-writer path; the enforcement seam recomputes the live
// digest and compares. A match means the on-disk bindings are exactly what the
// engine produced; a mismatch means they were hand-edited outside the engine — a
// tamper the seam surfaces instead of silently trusting a possibly-weakened state.
//
// This is tamper-EVIDENT, not tamper-proof: the lock is a project file, so a
// determined user can edit both it and the bindings. It catches accidental drift,
// careless edits, partial edits, and any change that did not go through the
// engine — which is the realistic threat for a team trust boundary. True
// prevention needs an offline signing key (a separate, deferred spine item).
//
// The schema is per-capability and extensible: F7 adds a version vector beside the
// digest. Today only the `rule-scripts` capability records one.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';

import { CAPABILITY_REGISTRY } from './registry.js';

export const CAPABILITY_LOCK_SCHEMA_VERSION = 1 as const;

/** One capability's blessed-state record. */
export interface CapabilityLockEntry {
  /** Hex digest of the capability's blessed on-disk state. */
  digest: string;
  /** The capability's policy-schema version at bless time (F7 version vector).
   *  Absent on pre-F7 locks — treated as "unversioned" by the compat check. */
  policy_version?: number;
  /** The capability's record-schema version at bless time (F7 version vector). */
  record_version?: number;
}

/** The per-capability schema versions recorded in the lock. */
export interface CapabilityVersions {
  policy: number;
  record: number;
}

export interface CapabilityLock {
  schema_version: typeof CAPABILITY_LOCK_SCHEMA_VERSION;
  generated_at: string;
  /** Keyed by capability id (CapabilityDescriptor['id']). */
  capabilities: Record<string, CapabilityLockEntry>;
}

export function capabilityLockPath(projectRoot: string): string {
  return join(projectRoot, PATHS.CAPABILITY_LOCK);
}

/** Read the whole lock, or null when absent / unparseable (treated as "no lock"). */
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

/** The blessed digest recorded for one capability, or null when none exists. */
export function readCapabilityDigest(projectRoot: string, capabilityId: string): string | null {
  const lock = readCapabilityLock(projectRoot);
  const entry = lock?.capabilities?.[capabilityId];
  return entry && typeof entry.digest === 'string' ? entry.digest : null;
}

/**
 * The per-capability schema versions blessed into the lock, or null when none were
 * recorded (a pre-F7 lock, or a capability the engine never blessed). The compat
 * check (F7) compares these against the install's registry versions.
 */
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

/**
 * Record one capability's blessed digest, MERGING into the existing lock so other
 * capabilities' entries are preserved (and forward-compat fields a newer engine
 * wrote are not clobbered). Engine-only — called from a capability's single-writer
 * path, never from the enforcement seam.
 *
 * Buildout F7: the blessing also stamps the capability's CURRENT schema versions
 * from the install's registry (the version vector). The compat check later reads
 * these back to detect an old install meeting a project blessed by a newer one.
 */
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
