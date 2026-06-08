// Engine version report (PQD-106).
//
// A consumer (a coding agent such as Claude Code, Codex CLI, Cursor, …) that
// imports `paqad-ai` needs a zero-cost, side-effect-free way to ask the engine
// what version it is, the oldest consumer it supports, and whether it considers
// itself deprecated — *before* any pipeline, gate, or file I/O runs. It can then
// refuse to start at the earliest possible moment with a clear message.
//
// `__PKG_VERSION__` is injected at build time by tsup (see tsup.config.ts) and
// by vitest (see vitest.config.ts), so it always equals the published
// package.json version. We read it the same way `src/index.ts` exports `VERSION`,
// rather than importing `VERSION` from the package barrel, to avoid a cycle
// (index.ts -> install/index.ts -> version-report.ts).
declare const __PKG_VERSION__: string;

/**
 * Sentinel returned for `engineVersion` when the engine was built without a
 * usable version string (AC5). A consumer can route this to a "broken engine
 * install" message instead of acting on an empty or invented version.
 */
export const VERSION_UNKNOWN = 'version unknown';

/**
 * The oldest consumer version the engine declares it is compatible with. The
 * comparison in {@link compareConsumerCompatibility} treats only a major-version
 * delta as breaking (semver), so this floor is enforced at the major level.
 */
export const MIN_CONSUMER_VERSION = '1.0.0';

/**
 * The version at which the engine considers itself deprecated, or `undefined`
 * when it is not deprecated. A set value lets a consumer show a soft warning
 * distinct from the hard "too old" / "too new" refusals. Updated manually before
 * a deprecation release.
 */
const DEPRECATED_AS_OF: string | undefined = undefined;

/** Immutable description of the engine's version and compatibility floor. */
export interface EngineVersionReport {
  /** The engine's own version, or {@link VERSION_UNKNOWN} on a broken build. */
  readonly engineVersion: string;
  /** The oldest consumer version the engine supports ({@link MIN_CONSUMER_VERSION}). */
  readonly minConsumerVersion: string;
  /** The version at which the engine became deprecated, or `undefined`. */
  readonly deprecatedAsOf: string | undefined;
}

/**
 * Normalise a raw build-time version string into a reportable value. Returns
 * {@link VERSION_UNKNOWN} when the build-time injection produced an empty string,
 * the unreplaced `__PKG_VERSION__` placeholder, or a non-string (AC5).
 *
 * Exported as a pure helper so the "version unknown" path is testable: the
 * build-time `__PKG_VERSION__` define is replaced textually at compile time and
 * cannot be mocked at runtime.
 */
export function normalizeEngineVersion(raw: unknown): string {
  if (typeof raw !== 'string') {
    return VERSION_UNKNOWN;
  }
  const trimmed = raw.trim();
  if (trimmed === '' || trimmed === '__PKG_VERSION__') {
    return VERSION_UNKNOWN;
  }
  return trimmed;
}

let memoizedReport: EngineVersionReport | undefined;

/**
 * Return the engine's version report. The result is a frozen object, computed
 * once and memoised for the process lifetime, so repeated calls return the
 * identical reference and perform no disk or network I/O (AC1, AC4). Calling it
 * forces no engine initialisation.
 */
export function getEngineVersionReport(): EngineVersionReport {
  if (memoizedReport === undefined) {
    memoizedReport = Object.freeze({
      engineVersion: normalizeEngineVersion(__PKG_VERSION__),
      minConsumerVersion: MIN_CONSUMER_VERSION,
      deprecatedAsOf: DEPRECATED_AS_OF,
    });
  }
  return memoizedReport;
}
