import { ACTIVE_CAPABILITIES, type ActiveCapability } from '@/core/types/domain.js';
import type { ProjectProfile } from '@/core/types/project-profile.js';
import {
  migrateProjectProfile,
  readProjectProfile,
  writeProjectProfile,
} from '@/core/project-profile.js';
import projectProfileSchema from '@/validators/schemas/project-profile.schema.json';
import { SchemaValidator, type SchemaValidationIssue } from '@/validators/validator.js';

import { appendDashboardAudit } from './approvals.js';

/**
 * Issue #146 — `/api/config/profile` and `/api/capabilities/{name}`.
 *
 * Reads and writes go through `readProjectProfile` / `writeProjectProfile`,
 * the exact functions every CLI command uses, so a dashboard edit is
 * indistinguishable from a CLI one (including canonical-form migration on
 * write). The profile is a structured form in the UI, so the PUT carries the
 * parsed object rather than raw YAML.
 */

export class ProfileValidationError extends Error {
  readonly issues: SchemaValidationIssue[];

  constructor(message: string, issues: SchemaValidationIssue[]) {
    super(message);
    this.name = 'ProfileValidationError';
    this.issues = issues;
  }
}

export interface ProfileConfig {
  profile: ProjectProfile | null;
  schema: Record<string, unknown>;
  capabilities: {
    available: readonly string[];
    active: string[];
  };
}

export function getProfileConfig(projectRoot: string): ProfileConfig {
  const profile = readProjectProfile(projectRoot);
  return {
    profile,
    schema: projectProfileSchema as Record<string, unknown>,
    capabilities: {
      available: ACTIVE_CAPABILITIES,
      active: profile?.active_capabilities ?? [],
    },
  };
}

export interface PutProfileResult {
  path: string;
  profile: ProjectProfile;
}

export function putProfile(projectRoot: string, candidate: unknown): PutProfileResult {
  if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) {
    throw new ProfileValidationError('The profile must be an object.', [
      { path: '/', message: 'Expected the parsed profile object.' },
    ]);
  }

  // Validate the canonical form — exactly what will be written to disk —
  // so legacy-shaped payloads cannot bypass the schema.
  const migrated = migrateProjectProfile(candidate as ProjectProfile);
  const validation = new SchemaValidator().validate('project-profile', migrated.profile);
  if (!validation.valid) {
    throw new ProfileValidationError(
      'The profile does not match the project-profile schema.',
      validation.errors,
    );
  }

  const path = writeProjectProfile(projectRoot, migrated.profile);
  appendDashboardAudit(projectRoot, 'dashboard.config.profile.write', {
    path: '.paqad/project-profile.yaml',
  });
  return { path, profile: migrated.profile };
}

export interface SetCapabilityResult {
  active: ActiveCapability[];
}

export function setCapability(
  projectRoot: string,
  name: string,
  enabled: boolean,
): SetCapabilityResult {
  if (!ACTIVE_CAPABILITIES.includes(name as ActiveCapability)) {
    throw new ProfileValidationError(`Unknown capability: ${name}.`, [
      { path: '/name', message: `Must be one of: ${ACTIVE_CAPABILITIES.join(', ')}.` },
    ]);
  }
  const profile = readProjectProfile(projectRoot);
  if (profile === null) {
    throw new ProfileValidationError('No project profile found. Run `paqad-ai onboard` first.', [
      { path: '/', message: 'project-profile.yaml is missing.' },
    ]);
  }

  const current = new Set(profile.active_capabilities);
  if (enabled) {
    current.add(name as ActiveCapability);
  } else {
    current.delete(name as ActiveCapability);
  }
  const updated: ProjectProfile = {
    ...profile,
    active_capabilities: Array.from(current) as ActiveCapability[],
  };
  // writeProjectProfile re-normalizes (capability ordering, security/coding
  // coupling), so what lands is the canonical form.
  writeProjectProfile(projectRoot, updated);
  appendDashboardAudit(projectRoot, 'dashboard.capabilities.set', {
    capability: name,
    enabled: String(enabled),
  });
  const persisted = readProjectProfile(projectRoot);
  return { active: persisted?.active_capabilities ?? [] };
}
