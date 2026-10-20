import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { PATHS } from './constants/paths.js';
import { configSaysPaqadDisabled, setConfigValue } from './framework-config.js';
import type { ProjectProfile } from './types/project-profile.js';

const ENV_TRUTHY = new Set(['1', 'true', 'yes', 'on']);

export function isEnvDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.PAQAD_DISABLED;
  return typeof raw === 'string' && ENV_TRUTHY.has(raw.trim().toLowerCase());
}

export function isFrameworkEnabled(
  profile: ProjectProfile | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (isEnvDisabled(env)) {
    return false;
  }
  return profile?.paqad?.enabled !== false;
}

export function isFrameworkEnabledForRoot(
  projectRoot: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (isEnvDisabled(env)) {
    return false;
  }
  return !configSaysPaqadDisabled(projectRoot, env);
}

export function isFrameworkDisabledForRoot(
  projectRoot: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return !isFrameworkEnabledForRoot(projectRoot, env);
}

export interface SetFrameworkEnabledResult {
  enabled: boolean;
  config_path: string;
}

export function setFrameworkEnabled(
  projectRoot: string,
  enabled: boolean,
): SetFrameworkEnabledResult {
  if (!existsSync(join(projectRoot, PATHS.PROJECT_PROFILE))) {
    throw new Error(
      'paqad is not onboarded in this project (no .paqad/project-profile.yaml). Run `paqad-ai onboard` first.',
    );
  }
  const config_path = setConfigValue(projectRoot, 'paqad_enable', enabled ? 'true' : 'false');
  return { enabled, config_path };
}
