declare const __PKG_VERSION__: string;

export const VERSION_UNKNOWN = 'version unknown';

export const MIN_CONSUMER_VERSION = '1.0.0';

const DEPRECATED_AS_OF: string | undefined = undefined;

export interface EngineVersionReport {
  readonly engineVersion: string;
  readonly minConsumerVersion: string;
  readonly deprecatedAsOf: string | undefined;
}

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
