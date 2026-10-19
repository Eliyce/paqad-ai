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

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

/** PAQAD_DISABLED values that mean "off" — identical to the .sh/.ts primitives. */
const ENV_TRUTHY = new Set(['1', 'true', 'yes', 'on']);
/** `paqad_enable` values that mean "off" — identical to the .sh/.ts primitives. */
const FALSY = new Set(['false', '0', 'no', 'off']);

/** True when PAQAD_DISABLED is set to a recognized truthy value. */
export function isEnvDisabled(env = process.env) {
  const raw = env.PAQAD_DISABLED;
  return typeof raw === 'string' && ENV_TRUTHY.has(raw.trim().toLowerCase());
}

/**
 * Best-effort parse of a hook's raw stdin payload into an object, or `undefined`.
 * `resolveProjectRoot` reads `payload.cwd` from it (issue #615, Part 1); every other
 * field is ignored here. A missing, empty, or malformed payload yields `undefined`, so a
 * call site that threads it keeps today's behavior when the host sends nothing readable.
 */
export function parseHookPayload(input) {
  if (typeof input !== 'string' || input.trim() === '') {
    return undefined;
  }
  try {
    const parsed = JSON.parse(input);
    return parsed && typeof parsed === 'object' ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Walk up from `startDir` to the first directory that contains a `.paqad/` directory,
 * returning that directory, or `undefined` when none is found before the filesystem root.
 */
export function findProjectRootFromCwd(startDir) {
  let dir = startDir;
  // Bounded by the filesystem root: dirname('/') === '/', so the loop terminates.
  for (;;) {
    try {
      if (statSync(join(dir, '.paqad')).isDirectory()) {
        return dir;
      }
    } catch {
      // No `.paqad/` here (or an unreadable entry) — keep walking up.
    }
    const parent = dirname(dir);
    if (parent === dir) {
      return undefined;
    }
    dir = parent;
  }
}

/**
 * Resolve the project root the host is operating on. In a worktree session Claude Code
 * sets `CLAUDE_PROJECT_DIR` to the MAIN checkout and only the hook payload's `cwd` holds
 * the worktree path (issue #615, Part 1), so when `payload.cwd` is a non-empty string we
 * walk up from it to the nearest `.paqad/` and use that. Otherwise — and when the walk
 * finds nothing — we fall back to the env-driven resolution, then `process.cwd()`, exactly
 * as before. A call site with no payload keeps today's behavior.
 */
export function resolveProjectRoot(env = process.env, payload = undefined) {
  const cwd = payload && typeof payload.cwd === 'string' ? payload.cwd.trim() : '';
  if (cwd) {
    const found = findProjectRootFromCwd(cwd);
    if (found) {
      return found;
    }
  }
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

// ─── Plugin-only onboarding guard (issue #636, bug 1) ────────────────────────────────────────────
//
// `claude plugin install` defaults to USER scope, so the plugin's hooks run in EVERY Claude Code
// session, in every repo — including repos that were never onboarded. The npm package never had this
// problem: it wires its hooks into each onboarded project's own `.claude/settings.json`, so an
// npm-reached hook (no CLAUDE_PLUGIN_ROOT) only ever runs inside an onboarded project. A plugin-
// reached hook (CLAUDE_PLUGIN_ROOT set) must restore that boundary explicitly: in a project that was
// never onboarded it is a pure no-op (never block, never write `.paqad/`). Onboarded-ness uses the
// same signal the framework bootstrap resolves — `.paqad/framework-path.txt` at the project root.

/** True when the project at `projectRoot` was onboarded (its `.paqad/framework-path.txt` exists). */
export function isProjectOnboarded(projectRoot = resolveProjectRoot()) {
  try {
    return statSync(join(projectRoot, '.paqad', 'framework-path.txt')).isFile();
  } catch {
    return false;
  }
}

/**
 * True when a plugin-reached hook must stand down because the project was never onboarded. This is a
 * plugin-only guard: an npm-reached hook (no CLAUDE_PLUGIN_ROOT) is left unchanged, because npm wires
 * its hooks only into onboarded projects. When CLAUDE_PLUGIN_ROOT is set and the resolved project has
 * no onboarding pointer, every plugin hook becomes a pure no-op (issue #636, bug 1).
 */
export function pluginStandsDownUnonboarded(payload = undefined, env = process.env) {
  if (!env.CLAUDE_PLUGIN_ROOT) {
    return false;
  }
  return !isProjectOnboarded(resolveProjectRoot(env, payload));
}

// ─── One-copy handshake (issue #616, Part 7; issue #667) ─────────────────────────────────────────
//
// Inside Claude Code the plugin and a globally-installed npm copy can both be wired to run paqad's
// hooks. For any session EXACTLY ONE chain runs (INV-3; issue #667 INV-1):
//   - claimed: the plugin's SessionStart writes a per-session marker, and every npm-reached hook (no
//     CLAUDE_PLUGIN_ROOT) steps aside for that session (npmHookStepsAside);
//   - passive: the session is unclaimed and the user or project Claude settings still wire a live npm
//     hook, so the plugin's SessionStart stays passive and every plugin-reached hook stands down
//     (pluginStandsDownPassive).
// Every hook guard asks the one combinator hookStandsDown. The marker is per-session (INV-4) so two
// sessions never ungate each other, and the default is to stay active: a hook with no evidence that
// the other copy owns the session keeps running (never silently off).

/** Claude Code's config dir: honours CLAUDE_CONFIG_DIR (set by the host), else ~/.claude. */
export function claudeDir(env = process.env) {
  return env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
}

/** The user-level Claude settings file. */
export function claudeSettingsPath(env = process.env) {
  return join(claudeDir(env), 'settings.json');
}

/**
 * The absolute `.mjs` script path a paqad hook command runs, or null when it is not a paqad hook.
 * Mirrored for the doctor by projectWiresLiveNpmHooks in src/install/plugin-migration.ts.
 */
export function paqadHookScriptPath(command) {
  if (typeof command !== 'string' || !command.includes('paqad')) return null;
  const m = command.match(/"([^"]+\.mjs)"|(\S+\.mjs)/);
  const path = m ? (m[1] ?? m[2]) : null;
  return path && path.includes('paqad') ? path : null;
}

/** Walk every hook command in a parsed settings object, yielding { event, ei, hi, command }. */
export function eachHookCommand(settings) {
  const out = [];
  const hooks = settings && typeof settings === 'object' ? settings.hooks : undefined;
  if (!hooks || typeof hooks !== 'object') return out;
  for (const [event, entries] of Object.entries(hooks)) {
    if (!Array.isArray(entries)) continue;
    entries.forEach((entry, ei) => {
      const inner = entry && Array.isArray(entry.hooks) ? entry.hooks : [];
      inner.forEach((hk, hi) => out.push({ event, ei, hi, command: hk && hk.command }));
    });
  }
  return out;
}

/**
 * Part 7: true when a Claude settings file still wires a LIVE paqad hook, one whose `.mjs`
 * script exists on disk. A missing or malformed file counts as not wired.
 */
export function hasLiveNpmHookLines(settingsPath = claudeSettingsPath(process.env)) {
  let settings;
  try {
    settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
  } catch {
    return false;
  }
  return eachHookCommand(settings).some(({ command }) => {
    const script = paqadHookScriptPath(command);
    return script !== null && existsSync(script);
  });
}

/**
 * The project-level Claude settings files the npm onboard writes its hook chain into
 * (issue #641, Gap 2): onboarding wires `<project>/.claude/settings.json` (and a developer
 * may add `settings.local.json`), NOT the user file. Both are checked so the handshake sees
 * the npm wiring wherever it actually lives.
 */
export function projectClaudeSettingsPaths(projectRoot) {
  return [
    join(projectRoot, '.claude', 'settings.json'),
    join(projectRoot, '.claude', 'settings.local.json'),
  ];
}

/**
 * Part 7 / issue #641: true when ANY of the given settings files still wires a LIVE paqad
 * hook. The one-copy handshake stays passive whenever a live npm copy is wired at EITHER the
 * user level or in the project, so an npm-onboarded repo never runs both chains.
 */
export function anyLiveNpmHookLines(settingsPaths) {
  return settingsPaths.some((path) => hasLiveNpmHookLines(path));
}

/** The per-session plugin-active marker directory for a project. */
export function pluginActiveMarkerDir(projectRoot) {
  return join(projectRoot, '.paqad', 'session', 'plugin-active.d');
}

/** The session id from the hook payload, falling back to CLAUDE_SESSION_ID, or '' when neither. */
export function sessionIdFrom(payload, env = process.env) {
  const fromPayload =
    payload && typeof payload.session_id === 'string' ? payload.session_id.trim() : '';
  if (fromPayload) return fromPayload;
  const fromEnv = env.CLAUDE_SESSION_ID;
  return typeof fromEnv === 'string' ? fromEnv.trim() : '';
}

/** True when the plugin has claimed THIS session (its per-session marker exists). */
export function isPluginActiveForSession(payload, env = process.env) {
  const sid = sessionIdFrom(payload, env);
  if (!sid) return false;
  const projectRoot = resolveProjectRoot(env, payload);
  try {
    return statSync(join(pluginActiveMarkerDir(projectRoot), sid)).isFile();
  } catch {
    return false;
  }
}

/** Claim this session for the plugin by writing its per-session marker. Best-effort, never throws. */
export function writePluginActiveMarker(payload, env = process.env) {
  const sid = sessionIdFrom(payload, env);
  if (!sid) return;
  const projectRoot = resolveProjectRoot(env, payload);
  try {
    const dir = pluginActiveMarkerDir(projectRoot);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, sid), new Date().toISOString());
  } catch {
    // Best-effort — a failed claim just leaves both copies active (fail-safe to ON, INV-4).
  }
}

/**
 * True when a npm-reached hook (no CLAUDE_PLUGIN_ROOT) should step aside because the plugin has
 * claimed this session. A plugin-reached hook (CLAUDE_PLUGIN_ROOT set) never steps aside here.
 */
export function npmHookStepsAside(payload, env = process.env) {
  return !env.CLAUDE_PLUGIN_ROOT && isPluginActiveForSession(payload, env);
}

/**
 * Issue #667: true when a plugin-reached hook (CLAUDE_PLUGIN_ROOT set) must stand down because the
 * plugin stays passive in this session. The session is not claimed (checked first: one stat, so a
 * claimed session never reads settings), the project is onboarded, and the user or project Claude
 * settings still wire a live npm hook. This is the exact test the plugin's SessionStart uses to stay
 * passive, so the two decisions cannot drift. An npm-reached hook never stands down here.
 */
export function pluginStandsDownPassive(payload = undefined, env = process.env) {
  if (!env.CLAUDE_PLUGIN_ROOT) return false;
  if (isPluginActiveForSession(payload, env)) return false;
  const projectRoot = resolveProjectRoot(env, payload);
  if (!isProjectOnboarded(projectRoot)) return false; // pluginStandsDownUnonboarded's job
  return anyLiveNpmHookLines([claudeSettingsPath(env), ...projectClaudeSettingsPaths(projectRoot)]);
}

/**
 * Issue #667: the one guard every plugin-reachable hook asks. True when THIS copy of the hook must
 * be a no-op for the session: the npm copy steps aside in a plugin-claimed session, and the plugin
 * copy stands down in a passive session or an un-onboarded repo, so exactly one chain runs.
 */
export function hookStandsDown(payload = undefined, env = process.env) {
  return (
    npmHookStepsAside(payload, env) ||
    pluginStandsDownPassive(payload, env) ||
    pluginStandsDownUnonboarded(payload, env)
  );
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

// ─── Future-schema handling for hooks (issue #616, Part 9) ───────────────────────────────────────
//
// When a hook loads the built dist and the project's .paqad/ layout was written by a NEWER paqad,
// the engine throws SchemaVersionError. A hook must never crash on that: it exits 0 (fails open) and
// appends ONE diagnosable line to .paqad/logs/hooks.log so the situation is visible. `doctor` then
// prints the verbatim update line. The predicate matches by the stable error code/name so a
// dist-less hook need not import the dist error class.

/** True when an error is paqad's future-schema refusal (matched without importing the dist class). */
export function isSchemaVersionError(err) {
  if (!err || typeof err !== 'object') return false;
  const code = /** @type {{ code?: unknown; name?: unknown }} */ (err).code;
  const name = /** @type {{ code?: unknown; name?: unknown }} */ (err).name;
  return code === 'SCHEMA_VERSION_INCOMPATIBLE' || name === 'SchemaVersionError';
}

/** Append one line to `.paqad/logs/hooks.log`, best-effort (never throws). */
export function appendHooksLog(projectRoot, line) {
  try {
    const dir = join(projectRoot, '.paqad', 'logs');
    mkdirSync(dir, { recursive: true });
    appendFileSync(join(dir, 'hooks.log'), `${new Date().toISOString()} ${line}\n`);
  } catch {
    // Logging is best-effort; a failure must not wedge the hook.
  }
}
