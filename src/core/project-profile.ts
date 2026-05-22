import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import YAML from 'yaml';

import { PATHS } from './constants/paths.js';
import { normalizeIntelligenceConfig } from './project-intelligence.js';
import { ACTIVE_CAPABILITIES, type ActiveCapability, type Domain } from './types/domain.js';
import type { DetectedStackProfile } from './types/introspection.js';
import type { ProjectProfile } from './types/project-profile.js';

type LegacyRouting = {
  domain?: Domain;
  stack?: string;
  capabilities?: string[];
};

type LegacyDetectedStackProfile = DetectedStackProfile & {
  domain?: Domain;
};

type ProjectProfileLike = Omit<
  ProjectProfile,
  'active_capabilities' | 'stack_profile' | 'routing'
> & {
  active_capabilities?: unknown;
  stack_profile?: LegacyDetectedStackProfile;
  routing?: LegacyRouting;
};

interface MigrationResult {
  profile: ProjectProfile;
  migrated: boolean;
  audit_message?: string;
}

export function readProjectProfile(projectRoot: string): ProjectProfile | null {
  const path = join(projectRoot, PATHS.PROJECT_PROFILE);
  if (!existsSync(path)) {
    return null;
  }

  try {
    const parsed = YAML.parse(readFileSync(path, 'utf8')) as ProjectProfileLike;
    const migration = migrateProjectProfile(parsed);

    if (migration.migrated) {
      writeProjectProfile(projectRoot, migration.profile, migration.audit_message);
    }

    return migration.profile;
  } catch {
    return null;
  }
}

export function writeProjectProfile(
  projectRoot: string,
  profile: ProjectProfileLike | ProjectProfile,
  auditMessage?: string,
): string {
  const migration = migrateProjectProfile(profile);
  const path = join(projectRoot, PATHS.PROJECT_PROFILE);

  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, YAML.stringify(migration.profile));

  if (auditMessage ?? migration.audit_message) {
    appendAuditLog(projectRoot, auditMessage ?? migration.audit_message ?? '');
  }

  return path;
}

export function migrateProjectProfile(input: ProjectProfileLike | ProjectProfile): MigrationResult {
  const legacy = input as ProjectProfileLike;
  const activeCapabilities = normalizeActiveCapabilities(
    legacy.active_capabilities,
    legacy.routing,
    legacy.stack_profile,
  );
  const stackProfile = normalizeStackProfile(legacy.stack_profile, activeCapabilities);

  const {
    active_capabilities: legacyActiveCapabilities,
    routing: legacyRouting,
    stack_profile: legacyStackProfile,
    ...rest
  } = legacy;
  void legacyActiveCapabilities;
  void legacyRouting;
  void legacyStackProfile;

  const profile: ProjectProfile = {
    ...rest,
    active_capabilities: activeCapabilities,
    stack_profile: stackProfile,
    intelligence: normalizeIntelligenceConfig(legacy.intelligence),
  };

  const migrated =
    !Array.isArray(legacy.active_capabilities) ||
    legacy.routing !== undefined ||
    legacy.stack_profile?.domain !== undefined ||
    activeCapabilities.includes('coding') !== Boolean(stackProfile) ||
    JSON.stringify(legacy.active_capabilities ?? []) !== JSON.stringify(activeCapabilities) ||
    JSON.stringify(legacy.intelligence ?? null) !== JSON.stringify(profile.intelligence) ||
    JSON.stringify(legacy.stack_profile ?? null) !== JSON.stringify(stackProfile ?? null);

  const audit_message = migrated
    ? `[${new Date().toISOString()}] Migrated project profile to canonical capabilities model`
    : undefined;

  return {
    profile,
    migrated,
    audit_message,
  };
}

export function getProfileDomain(
  profile: Partial<Pick<ProjectProfile, 'active_capabilities' | 'stack_profile' | 'routing'>>,
): Domain {
  if (profile.active_capabilities?.includes('coding')) {
    return 'coding';
  }

  if (profile.routing?.domain === 'coding') {
    return 'coding';
  }

  if ((profile.stack_profile?.frameworks ?? []).length > 0) {
    return 'coding';
  }

  return 'content';
}

function normalizeActiveCapabilities(
  raw: unknown,
  routing?: LegacyRouting,
  stackProfile?: LegacyDetectedStackProfile,
): ActiveCapability[] {
  const values = new Set<ActiveCapability>();
  values.add('content');

  if (Array.isArray(raw)) {
    for (const value of raw) {
      if (typeof value === 'string' && ACTIVE_CAPABILITIES.includes(value as ActiveCapability)) {
        values.add(value as ActiveCapability);
      }
    }
  }

  const frameworks = (stackProfile?.frameworks ?? []).filter(
    (framework) => framework !== 'short-video',
  );
  const hasCodingSignals = frameworks.length > 0 || routing?.domain === 'coding';

  if (hasCodingSignals) {
    values.add('coding');
  }

  if (values.has('coding')) {
    values.add('security');
  } else {
    values.delete('security');
  }

  return Array.from(values).sort(compareActiveCapabilities);
}

function normalizeStackProfile(
  stackProfile: LegacyDetectedStackProfile | undefined,
  activeCapabilities: ActiveCapability[],
): DetectedStackProfile | undefined {
  if (!activeCapabilities.includes('coding') || !stackProfile) {
    return undefined;
  }

  const frameworks = (stackProfile.frameworks ?? []).filter(
    (framework) => framework !== 'short-video',
  );
  if (frameworks.length === 0) {
    return undefined;
  }

  return {
    frameworks: frameworks.sort(),
    traits: [...(stackProfile.traits ?? [])].sort(),
    toolchains: [...(stackProfile.toolchains ?? [])],
    version_bands: [...(stackProfile.version_bands ?? [])],
    sources: [...(stackProfile.sources ?? [])],
  };
}

function appendAuditLog(projectRoot: string, entry: string): void {
  const path = join(projectRoot, '.paqad', 'audit.log');
  mkdirSync(dirname(path), { recursive: true });

  const current = existsSync(path) ? readFileSync(path, 'utf8') : '';
  const normalized = current.endsWith('\n') || current.length === 0 ? current : `${current}\n`;
  writeFileSync(path, `${normalized}${entry}\n`);
}

function compareActiveCapabilities(left: ActiveCapability, right: ActiveCapability): number {
  return ACTIVE_CAPABILITIES.indexOf(left) - ACTIVE_CAPABILITIES.indexOf(right);
}
