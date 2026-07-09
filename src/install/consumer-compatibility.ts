// Consumer/engine compatibility check (PQD-106).
//
// A consumer calls this with its own version and the engine's version report
// (from `getEngineVersionReport()`) to decide, at startup, whether it can safely
// run against this engine. Comparison follows semver: only a major-version delta
// is breaking — minor and patch differences (and pre-release suffixes within the
// same major) are non-breaking and return 'ok' (AC3).
//
// We compare major versions with a pure integer parse rather than depending on a
// `semver` package, keeping the dependency surface unchanged (none was present).

import { VERSION_UNKNOWN, type EngineVersionReport } from './version-report.js';

/**
 * The outcome of comparing a consumer against an engine version report:
 * - `'ok'` — the consumer can run against this engine.
 * - `'engine-too-new'` — the consumer is older than the engine's required
 *   minimum consumer; the engine demands a newer consumer (AC2).
 * - `'engine-too-old'` — the consumer is on a newer major than the engine
 *   provides; the engine is below what the consumer requires (AC3).
 * - `'engine-version-unknown'` — the engine reported no usable version (AC5).
 */
export type ConsumerCompatibility =
  'ok' | 'engine-too-new' | 'engine-too-old' | 'engine-version-unknown';

// Parse the leading major-version integer from a semver string, tolerating an
// optional leading `v` and any `-prerelease`/`+build` suffix. Returns NaN when no
// leading integer is present.
function parseMajor(version: string): number {
  const match = /^\s*v?(\d+)/u.exec(version);
  return match ? Number.parseInt(match[1], 10) : Number.NaN;
}

/**
 * Compare a consumer version against the engine's version report.
 *
 * Returns `'engine-version-unknown'` when the engine has no usable version.
 * A consumer whose version cannot be parsed is treated conservatively as below
 * the floor (`'engine-too-new'`) so a broken consumer refuses to start rather
 * than proceeding silently.
 */
export function compareConsumerCompatibility(
  consumerVersion: string,
  report: EngineVersionReport,
): ConsumerCompatibility {
  if (report.engineVersion === VERSION_UNKNOWN) {
    return 'engine-version-unknown';
  }

  const consumerMajor = parseMajor(consumerVersion);
  if (Number.isNaN(consumerMajor)) {
    return 'engine-too-new';
  }

  const minConsumerMajor = parseMajor(report.minConsumerVersion);
  if (!Number.isNaN(minConsumerMajor) && consumerMajor < minConsumerMajor) {
    return 'engine-too-new';
  }

  const engineMajor = parseMajor(report.engineVersion);
  if (!Number.isNaN(engineMajor) && consumerMajor > engineMajor) {
    return 'engine-too-old';
  }

  return 'ok';
}
