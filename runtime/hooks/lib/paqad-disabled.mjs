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
//   2. PAQAD_ENABLED=false in .paqad/.config ⇒ off (git-ignored local toggle).
//   3. absent ⇒ on (default-on; existing behavior unchanged).
//
// Deliberately dist-less and dependency-free (a raw read, no parser import) so a
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
 * otherwise read `PAQAD_ENABLED=false` raw from `.paqad/.config`. Absent ⇒ enabled.
 */
export function isPaqadDisabled(projectRoot = resolveProjectRoot(), env = process.env) {
  if (isEnvDisabled(env)) {
    return true;
  }
  return configSaysDisabled(projectRoot);
}

/**
 * Raw read of the off-signal from `.paqad/.config`. Scans for the last
 * uncommented `PAQAD_ENABLED=` assignment, strips quotes / inline comment, and
 * reports disabled iff the value is a falsy token (`false`/`0`/`no`/`off`).
 */
function configSaysDisabled(projectRoot) {
  let raw;
  try {
    raw = readFileSync(join(projectRoot, '.paqad', '.config'), 'utf8');
  } catch {
    return false; // absent/unreadable ⇒ default-on
  }
  let value;
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?PAQAD_ENABLED\s*=(.*)$/);
    if (m) {
      value = m[1];
    }
  }
  if (value === undefined) {
    return false;
  }
  let v = value.trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    v = v.slice(1, -1);
  } else {
    const hash = v.search(/\s#/);
    if (hash !== -1) {
      v = v.slice(0, hash).trim();
    }
  }
  v = v.trim().toLowerCase();
  return v === 'false' || v === '0' || v === 'no' || v === 'off';
}
