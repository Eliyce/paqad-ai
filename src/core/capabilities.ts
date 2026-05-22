import type { ActiveCapability } from './types/domain.js';
import type { ProjectProfile } from './types/project-profile.js';

export const ACTIVE_CAPABILITY_ORDER: ActiveCapability[] = ['content', 'coding', 'security'];
export const MANAGEABLE_ACTIVE_CAPABILITIES: ActiveCapability[] = ['content', 'coding'];

export function listAvailableActiveCapabilities(): ActiveCapability[] {
  return [...MANAGEABLE_ACTIVE_CAPABILITIES];
}

export function isActiveCapability(value: string): value is ActiveCapability {
  return ACTIVE_CAPABILITY_ORDER.includes(value as ActiveCapability);
}

export function isManageableActiveCapability(value: string): value is ActiveCapability {
  return MANAGEABLE_ACTIVE_CAPABILITIES.includes(value as ActiveCapability);
}

export function assertActiveCapability(value: string): ActiveCapability {
  if (!isActiveCapability(value)) {
    throw new Error(
      `Unknown capability "${value}". Expected one of: ${MANAGEABLE_ACTIVE_CAPABILITIES.join(', ')}`,
    );
  }

  if (!isManageableActiveCapability(value)) {
    throw new Error(
      `Capability "${value}" is dependency-managed and cannot be changed directly. Manage "coding" instead.`,
    );
  }

  return value;
}

export function normalizeActiveCapabilities(
  capabilities: Iterable<ActiveCapability>,
): ActiveCapability[] {
  const values = new Set<ActiveCapability>(['content']);

  for (const capability of capabilities) {
    if (ACTIVE_CAPABILITY_ORDER.includes(capability)) {
      values.add(capability);
    }
  }

  if (values.has('coding')) {
    values.add('security');
  } else {
    values.delete('security');
  }

  return ACTIVE_CAPABILITY_ORDER.filter((capability) => values.has(capability));
}

export function addActiveCapability(
  profile: ProjectProfile,
  capability: ActiveCapability,
): ProjectProfile {
  return {
    ...profile,
    active_capabilities: normalizeActiveCapabilities([...profile.active_capabilities, capability]),
  };
}

export function removeActiveCapability(
  profile: ProjectProfile,
  capability: ActiveCapability,
): ProjectProfile {
  if (capability === 'content') {
    throw new Error('content capability cannot be removed');
  }

  const next = profile.active_capabilities.filter((value) => value !== capability);
  const normalized = normalizeActiveCapabilities(next);

  return {
    ...profile,
    active_capabilities: normalized,
    stack_profile: normalized.includes('coding') ? profile.stack_profile : undefined,
  };
}
