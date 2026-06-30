// Issue #220 / #227 — the global enable/disable master switch, .mjs side.
//
// Imported by every Node enforcement surface that must early-exit to a pure
// no-op when paqad is off, BEFORE it loads the built dist:
//   - runtime/scripts/verify-backstop.mjs (→ completion hooks + git/CI backstop)
//   - runtime/hooks/silent-update.mjs
//
// Precedence (must match runtime/hooks/lib/paqad-disabled.sh and the TS predicate
// src/core/framework-enabled.ts — pinned by the shared golden-fixture test):
//   1. PAQAD_DISABLED env override (truthy ⇒ off) wins over everything.
//   2. `paqad_enable` resolved across the layered config surfaces, highest first:
//        PAQAD_ENABLE env > .paqad/.config (dev-local) > .paqad/configs/.config.*
//        (team, merged sorted last-wins). A falsy token ⇒ off.
//   3. absent ⇒ on (default-on; existing behavior unchanged).
//
// Deliberately dist-less and dependency-free (a raw read, no parser import) so a
// disabled-and-uninstalled project can still evaluate its own toggle.

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/** PAQAD_DISABLED values that mean "off" — identical to the .sh/.ts primitives. */
const ENV_TRUTHY = new Set(['1', 'true', 'yes', 'on']);
/** `paqad_enable` values that mean "off" — identical to the .sh/.ts primitives. */
const FALSY = new Set(['false', '0', 'no', 'off']);

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
 * True when paqad is disabled for the given project root. The PAQAD_DISABLED env
 * hard switch wins; otherwise the layered `paqad_enable` resolution decides.
 */
export function isPaqadDisabled(projectRoot = resolveProjectRoot(), env = process.env) {
  if (isEnvDisabled(env)) {
    return true;
  }
  const resolved = resolvePaqadEnable(projectRoot, env);
  return resolved !== undefined && FALSY.has(resolved);
}

/**
 * Resolve the raw, lowercased `paqad_enable` value across the four surfaces, or
 * undefined when no surface sets it.
 */
function resolvePaqadEnable(projectRoot, env) {
  const raw = readLayeredKey(projectRoot, 'paqad_enable', 'PAQAD_ENABLE', env);
  return raw === undefined ? undefined : raw.trim().toLowerCase();
}

/**
 * Resolve a single config key across the layered surfaces, returning the raw
 * (un-lowercased) value or undefined. Layering matches the TS `layeredConfigMap`:
 * team `configs/.config.*` (merged, sorted last-wins) is the base, `.config`
 * (local) overrides it, and the `envName` env var overrides both. The shared
 * dist-less reader behind both this primitive and silent-update.mjs.
 */
export function readLayeredKey(projectRoot, key, envName, env = process.env) {
  let value = readKeyFromConfigsDir(projectRoot, key); // team (lowest)
  const local = readKeyFromFile(join(projectRoot, '.paqad', '.config'), key);
  if (local !== undefined) {
    value = local; // LOCAL WINS over team
  }
  const fromEnv = env[envName];
  if (typeof fromEnv === 'string' && fromEnv.trim() !== '') {
    value = fromEnv.trim(); // env escape hatch wins over both files
  }
  return value;
}

/**
 * Resolve an ENFORCED capability-mode knob with the team value as a FLOOR
 * (buildout F2, decision D1 — the C2 clamp). Mirrors the TS `resolveFlooredMode`:
 * the tracked `configs/.config.*` value is the floor; the local `.config` and the
 * `envName` env var may only RAISE strictness above it, never lower it. `order`
 * lists modes weakest → strictest. Unrecognised values are ignored. With nothing
 * set the `def` applies and is itself the floor (a lone dev cannot drop below it).
 */
export function readFlooredMode(projectRoot, key, envName, order, def, env = process.env) {
  const norm = (raw) => {
    if (raw === undefined || raw === null) return undefined;
    const v = String(raw).trim().toLowerCase();
    return order.includes(v) ? v : undefined;
  };
  const team = norm(readKeyFromConfigsDir(projectRoot, key));
  const local = norm(readKeyFromFile(join(projectRoot, '.paqad', '.config'), key));
  const fromEnv = norm(env[envName]);
  let rank = order.indexOf(team ?? def);
  for (const raising of [local, fromEnv]) {
    if (raising !== undefined) {
      rank = Math.max(rank, order.indexOf(raising));
    }
  }
  return order[rank];
}

/** Last uncommented `key=` value in a flat config file (quotes/inline-comment
 *  stripped), or undefined. Absent/unreadable file ⇒ undefined. */
function readKeyFromFile(path, key) {
  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    return undefined;
  }
  let value;
  const re = new RegExp(`^\\s*(?:export\\s+)?${key}\\s*=(.*)$`);
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(re);
    if (m) {
      value = m[1];
    }
  }
  if (value === undefined) {
    return undefined;
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
  return v;
}

/** Merge `key` across `.paqad/configs/.config.*` in sorted filename order
 *  (last wins), matching the TS resolver. Absent dir ⇒ undefined. */
function readKeyFromConfigsDir(projectRoot, key) {
  const dir = join(projectRoot, '.paqad', 'configs');
  let names;
  try {
    names = readdirSync(dir);
  } catch {
    return undefined;
  }
  let value;
  for (const name of names
    .filter((n) => /^\.config\..+/.test(n) && n !== '.config.example')
    .sort()) {
    const fromFile = readKeyFromFile(join(dir, name), key);
    if (fromFile !== undefined) {
      value = fromFile;
    }
  }
  return value;
}
