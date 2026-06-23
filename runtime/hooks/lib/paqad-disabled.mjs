// Issue #220 — the global enable/disable master switch, .mjs side.
//
// Imported by every Node enforcement surface that must early-exit to a pure
// no-op when paqad is off, BEFORE it loads the built dist:
//   - runtime/scripts/verify-backstop.mjs (→ completion hooks + git/CI backstop)
//   - runtime/hooks/silent-update.mjs
//
// Precedence (must match runtime/hooks/lib/paqad-disabled.sh and the TS
// predicate src/core/framework-enabled.ts):
//   1. PAQAD_DISABLED env override (truthy ⇒ off) wins over everything.
//   2. paqad.enabled: false in .paqad/project-profile.yaml ⇒ off.
//   3. absent ⇒ on (default-on; existing behavior unchanged).
//
// Deliberately dist-less and dependency-free (a raw read, no YAML parser) so a
// disabled-and-uninstalled project can still evaluate its own toggle.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** PAQAD_DISABLED values that mean "off" — identical to the .sh/.ts primitives. */
const ENV_TRUTHY = new Set(['1', 'true', 'yes', 'on']);

/** True when PAQAD_DISABLED is set to a recognized truthy value. */
export function isEnvDisabled(env = process.env) {
  const raw = env.PAQAD_DISABLED;
  return typeof raw === 'string' && ENV_TRUTHY.has(raw.trim().toLowerCase());
}

/** Resolve the project root the host is operating on (env-driven, cwd fallback). */
export function resolveProjectRoot(env = process.env) {
  return env.CLAUDE_PROJECT_DIR || env.PAQAD_PROJECT_ROOT || process.cwd();
}

/**
 * True when paqad is disabled for the given project root. Env override wins;
 * otherwise read `paqad.enabled: false` raw from the profile. Absent ⇒ enabled.
 */
export function isPaqadDisabled(projectRoot = resolveProjectRoot(), env = process.env) {
  if (isEnvDisabled(env)) {
    return true;
  }
  return profileSaysDisabled(projectRoot);
}

/**
 * Raw read of `paqad.enabled: false`. `enabled:` is not unique across the
 * profile, so scope the match to the top-level `paqad:` block before checking
 * its indented body.
 */
function profileSaysDisabled(projectRoot) {
  let raw;
  try {
    raw = readFileSync(join(projectRoot, '.paqad', 'project-profile.yaml'), 'utf8');
  } catch {
    return false; // absent/unreadable ⇒ default-on
  }
  const block = raw.match(/^paqad:\s*\n((?:[ \t]+.*\n?)*)/m);
  if (!block) {
    return false;
  }
  return /^[ \t]+enabled:\s*false\b/m.test(block[1]);
}
