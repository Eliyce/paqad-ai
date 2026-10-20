import { readCapabilityVersions } from './capability-lock.js';
import type { CapabilityDescriptor } from './registry.js';

export type CapabilityCompat = 'current' | 'project-behind' | 'project-ahead' | 'unversioned';

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

export function isRefusedByCompat(compat: CapabilityCompat): boolean {
  return compat === 'project-ahead';
}
