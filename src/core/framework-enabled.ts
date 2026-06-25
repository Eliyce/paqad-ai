// Issue #220 — the global enable/disable master switch, TS side.
//
// Resolves whether paqad is enabled for a project. Three rules, in precedence
// order:
//   1. `PAQAD_DISABLED` env override (truthy ⇒ disabled) wins over everything,
//      so an A/B harness can flip arms without touching files — and a *disabled*
//      signal is honored even when the built dist is missing.
//   2. `PAQAD_ENABLED=false` in `.paqad/.config` ⇒ disabled (the durable, local
//      team choice; `.config` is git-ignored and shared out of band).
//   3. Absent ⇒ enabled (safe default; existing behavior unchanged).
//
// `isFrameworkEnabledForRoot` reads the off-signal straight off disk WITHOUT the
// migrating `readProjectProfile` path, because resolving "is paqad off?" must
// itself write nothing — an OFF turn has to leave a clean tree. This mirrors the
// dist-less shell/`.mjs` primitives (`runtime/hooks/lib/paqad-disabled.{sh,mjs}`)
// so all three agree; the env-truthy set below is kept identical across them.
//
// This is also the seam the license/token validator (#217) composes through:
// "no valid token ⇒ vanilla mode" resolves to the same OFF path here.

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { PATHS } from './constants/paths.js';
import { configSaysPaqadDisabled, setConfigValue } from './framework-config.js';
import type { ProjectProfile } from './types/project-profile.js';

/** `PAQAD_DISABLED` values that mean "off" — identical to the `.sh` and `.mjs`
 *  primitives. Anything else (including `0`, `false`, empty, unset) is ON. */
const ENV_TRUTHY = new Set(['1', 'true', 'yes', 'on']);

/** True when `PAQAD_DISABLED` is set to a recognized truthy value. */
export function isEnvDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.PAQAD_DISABLED;
  return typeof raw === 'string' && ENV_TRUTHY.has(raw.trim().toLowerCase());
}

/**
 * Resolve enablement from an already-loaded profile. Precedence: env override
 * wins; then `paqad.enabled === false`; absent/`true`/malformed ⇒ enabled.
 */
export function isFrameworkEnabled(
  profile: ProjectProfile | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (isEnvDisabled(env)) {
    return false;
  }
  return profile?.paqad?.enabled !== false;
}

/**
 * Resolve enablement for a project root with zero side effects. Raw-reads the
 * off-signal out of `.paqad/.config` (no migration write) so a disabled turn
 * writes nothing. An absent `.config` ⇒ enabled.
 */
export function isFrameworkEnabledForRoot(
  projectRoot: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (isEnvDisabled(env)) {
    return false;
  }
  return !configSaysPaqadDisabled(projectRoot);
}

/** Convenience inverse of {@link isFrameworkEnabledForRoot}. */
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

/**
 * Flip the durable `PAQAD_ENABLED` flag in `.paqad/.config` — the write behind
 * `paqad-ai enable` / `paqad-ai disable`. Requires an onboarded project (a
 * profile must exist) so we never create a `.config` in a non-paqad directory.
 * The toggle is "inert but present": flipping back to `true` re-enables full
 * paqad with no re-onboarding. The `PAQAD_DISABLED` env override is intentionally
 * NOT touched here — it is a per-run override the user controls separately.
 */
export function setFrameworkEnabled(
  projectRoot: string,
  enabled: boolean,
): SetFrameworkEnabledResult {
  if (!existsSync(join(projectRoot, PATHS.PROJECT_PROFILE))) {
    throw new Error(
      'paqad is not onboarded in this project (no .paqad/project-profile.yaml). Run `paqad-ai onboard` first.',
    );
  }
  const config_path = setConfigValue(projectRoot, 'PAQAD_ENABLED', enabled ? 'true' : 'false');
  return { enabled, config_path };
}
