import { compareConsumerCompatibility } from '@/install/consumer-compatibility';
import { VERSION_UNKNOWN, type EngineVersionReport } from '@/install/version-report';

function report(overrides: Partial<EngineVersionReport> = {}): EngineVersionReport {
  return Object.freeze({
    engineVersion: '1.5.0',
    minConsumerVersion: '1.0.0',
    deprecatedAsOf: undefined,
    ...overrides,
  });
}

describe('compareConsumerCompatibility (PQD-106)', () => {
  it('returns ok when the consumer is within range', () => {
    expect(compareConsumerCompatibility('1.0.0', report())).toBe('ok');
    expect(compareConsumerCompatibility('1.9.9', report())).toBe('ok');
  });

  it('returns engine-too-new when the consumer is below the required minimum (AC2)', () => {
    expect(compareConsumerCompatibility('0.9.0', report())).toBe('engine-too-new');
  });

  it('returns engine-too-old when the consumer is a newer major than the engine (AC3)', () => {
    expect(compareConsumerCompatibility('2.0.0', report())).toBe('engine-too-old');
  });

  it('treats higher minor/patch within the same major as ok (AC3)', () => {
    expect(compareConsumerCompatibility('1.4.0', report({ engineVersion: '1.2.0' }))).toBe('ok');
    expect(compareConsumerCompatibility('1.0.7', report({ engineVersion: '1.0.1' }))).toBe('ok');
  });

  it('returns engine-version-unknown when the engine reported no version (AC5)', () => {
    expect(compareConsumerCompatibility('1.0.0', report({ engineVersion: VERSION_UNKNOWN }))).toBe(
      'engine-version-unknown',
    );
  });

  it('treats a same-major pre-release consumer as ok (only major deltas break)', () => {
    expect(compareConsumerCompatibility('1.0.0-rc.1', report())).toBe('ok');
    expect(compareConsumerCompatibility('1.2.0-beta.3', report({ engineVersion: '1.5.0' }))).toBe(
      'ok',
    );
  });

  it('tolerates a leading v prefix on the consumer version', () => {
    expect(compareConsumerCompatibility('v1.3.0', report())).toBe('ok');
  });

  it('conservatively refuses an unparseable consumer version', () => {
    expect(compareConsumerCompatibility('not-a-version', report())).toBe('engine-too-new');
  });
});
