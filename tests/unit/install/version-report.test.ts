import { readFileSync } from 'node:fs';

import {
  getEngineVersionReport,
  normalizeEngineVersion,
  MIN_CONSUMER_VERSION,
  VERSION_UNKNOWN,
} from '@/install/version-report';

const packageVersion = JSON.parse(
  readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'),
).version;

describe('getEngineVersionReport (PQD-106)', () => {
  it('reports the package version on a normal build', () => {
    expect(getEngineVersionReport().engineVersion).toBe(packageVersion);
  });

  it('returns a frozen object', () => {
    const report = getEngineVersionReport();
    expect(Object.isFrozen(report)).toBe(true);
  });

  it('returns the identical reference on repeated calls (AC4)', () => {
    const first = getEngineVersionReport();
    const refs = Array.from({ length: 10 }, () => getEngineVersionReport());
    for (const ref of refs) {
      expect(ref).toBe(first);
    }
  });

  it('declares the minimum consumer version it requires', () => {
    expect(getEngineVersionReport().minConsumerVersion).toBe(MIN_CONSUMER_VERSION);
  });

  it('leaves deprecatedAsOf undefined when not deprecated', () => {
    expect(getEngineVersionReport().deprecatedAsOf).toBeUndefined();
  });
});

describe('normalizeEngineVersion (PQD-106 AC5)', () => {
  it('passes through a real version string', () => {
    expect(normalizeEngineVersion('1.2.3')).toBe('1.2.3');
    expect(normalizeEngineVersion('  2.0.0  ')).toBe('2.0.0');
  });

  it('returns VERSION_UNKNOWN for an empty build-time string', () => {
    expect(normalizeEngineVersion('')).toBe(VERSION_UNKNOWN);
    expect(normalizeEngineVersion('   ')).toBe(VERSION_UNKNOWN);
  });

  it('returns VERSION_UNKNOWN for the unreplaced placeholder', () => {
    expect(normalizeEngineVersion('__PKG_VERSION__')).toBe(VERSION_UNKNOWN);
  });

  it('returns VERSION_UNKNOWN for a non-string', () => {
    expect(normalizeEngineVersion(undefined)).toBe(VERSION_UNKNOWN);
    expect(normalizeEngineVersion(null)).toBe(VERSION_UNKNOWN);
    expect(normalizeEngineVersion(42)).toBe(VERSION_UNKNOWN);
  });
});
