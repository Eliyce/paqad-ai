// The Capability Kernel compatibility check (buildout F7 — decision D2, version skew).
//
// The install (this package) is the trusted, versioned home of every capability's
// schema; the registry's policy/record versions are the install's MANDATORY FLOOR —
// the schema this engine knows how to enforce. The project's capability-lock.json
// records the versions the engine blessed its on-disk state under (the F7 vector).
//
// When install and project disagree, D2 says resolve it ONE way — refuse cleanly,
// never silently misenforce on a shape this engine does not understand:
//   - current        lock == registry → enforce normally.
//   - project-behind  lock < registry (blessed by an OLDER install) → forward-
//                     compatible; the engine re-blesses on its next writer pass.
//                     Enforcement continues.
//   - project-ahead   lock > registry (this OLD install met a project a NEWER
//                     install blessed) → REFUSE: this engine predates the schema and
//                     cannot be trusted to read it. Silent-update heals the install,
//                     then the next run is `current`.
//   - unversioned     no vector (pre-F7 lock, or never blessed) → nothing to compare;
//                     the digest gate still runs, so enforcement continues.

import { readCapabilityVersions } from './capability-lock.js';
import type { CapabilityDescriptor } from './registry.js';

export type CapabilityCompat = 'current' | 'project-behind' | 'project-ahead' | 'unversioned';

/**
 * Compare the project's blessed version vector against the install's registry for one
 * capability. `project-ahead` on EITHER dimension (policy or record) dominates — the
 * strictest, safest reading: any schema newer than this install means refuse.
 */
export function evaluateCapabilityCompat(
  projectRoot: string,
  descriptor: CapabilityDescriptor,
): CapabilityCompat {
  const blessed = readCapabilityVersions(projectRoot, descriptor.id);
  if (blessed === null) {
    return 'unversioned';
  }
  if (
    blessed.policy > descriptor.policySchemaVersion ||
    blessed.record > descriptor.recordSchemaVersion
  ) {
    return 'project-ahead';
  }
  if (
    blessed.policy < descriptor.policySchemaVersion ||
    blessed.record < descriptor.recordSchemaVersion
  ) {
    return 'project-behind';
  }
  return 'current';
}

/**
 * Whether a compat verdict means the install must REFUSE to enforce (D2). Only the
 * project-ahead case — an install too old to safely understand the project's schema.
 */
export function isRefusedByCompat(compat: CapabilityCompat): boolean {
  return compat === 'project-ahead';
}
