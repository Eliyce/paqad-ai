import { VERSION_UNKNOWN, type EngineVersionReport } from './version-report.js';

export type ConsumerCompatibility =
  'ok' | 'engine-too-new' | 'engine-too-old' | 'engine-version-unknown';

function parseMajor(version: string): number {
  const match = /^\s*v?(\d+)/u.exec(version);
  return match ? Number.parseInt(match[1], 10) : Number.NaN;
}

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
