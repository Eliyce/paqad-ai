// Issue #220 — the global enable/disable master switch, TS side.
//
// Resolves whether paqad is enabled for a project. Three rules, in precedence
// order:
//   1. `PAQAD_DISABLED` env override (truthy ⇒ disabled) wins over everything,
//      so an A/B harness can flip arms without touching tracked files — and a
//      *disabled* signal is honored even when the built dist is missing.
//   2. `paqad.enabled: false` in `.paqad/project-profile.yaml` ⇒ disabled (the
//      durable, committed team choice).
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

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PATHS } from './constants/paths.js';
import { readProjectProfile, writeProjectProfile } from './project-profile.js';
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
 * off-signal out of `project-profile.yaml` (no YAML parse, no migration write)
 * so a disabled turn writes nothing. An absent/unreadable profile ⇒ enabled.
 */
export function isFrameworkEnabledForRoot(
  projectRoot: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (isEnvDisabled(env)) {
    return false;
  }
  return !profileSaysDisabled(projectRoot);
}

/** Convenience inverse of {@link isFrameworkEnabledForRoot}. */
export function isFrameworkDisabledForRoot(
  projectRoot: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return !isFrameworkEnabledForRoot(projectRoot, env);
}

/**
 * Raw, side-effect-free read of `paqad.enabled: false`. `enabled:` is not unique
 * across the profile (enterprise, intelligence, … all use it), so the read is
 * scoped to the top-level `paqad:` block: match `^paqad:` followed by its
 * indented body, then look for `enabled: false` only inside that body.
 */
function profileSaysDisabled(projectRoot: string): boolean {
  let raw: string;
  try {
    raw = readFileSync(join(projectRoot, PATHS.PROJECT_PROFILE), 'utf8');
  } catch {
    return false; // absent/unreadable ⇒ default-on
  }
  const block = raw.match(/^paqad:\s*\n((?:[ \t]+.*\n?)*)/m);
  if (!block) {
    return false;
  }
  return /^[ \t]+enabled:\s*false\b/m.test(block[1]);
}

export interface SetFrameworkEnabledResult {
  enabled: boolean;
  profile_path: string;
}

/**
 * Flip the durable `paqad.enabled` flag in `project-profile.yaml` — the write
 * behind `paqad-ai enable` / `paqad-ai disable`. Requires an onboarded project
 * (a profile must exist); the toggle is "inert but present", so flipping back to
 * `true` re-enables full paqad with no re-onboarding. The `PAQAD_DISABLED` env
 * override is intentionally NOT touched here — it is a per-run override the user
 * controls separately.
 */
export function setFrameworkEnabled(
  projectRoot: string,
  enabled: boolean,
): SetFrameworkEnabledResult {
  const profile = readProjectProfile(projectRoot);
  if (!profile) {
    throw new Error(
      'paqad is not onboarded in this project (no .paqad/project-profile.yaml). Run `paqad-ai onboard` first.',
    );
  }
  const next: ProjectProfile = {
    ...profile,
    paqad: { ...(profile.paqad ?? {}), enabled },
  };
  const auditMessage = `[${new Date().toISOString()}] paqad ${
    enabled ? 'enabled' : 'disabled'
  } via CLI (paqad.enabled=${enabled})`;
  const profilePath = writeProjectProfile(projectRoot, next, auditMessage);
  return { enabled, profile_path: profilePath };
}
