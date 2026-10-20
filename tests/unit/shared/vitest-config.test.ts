import { afterEach, describe, expect, it, vi } from 'vitest';

async function loadConfig() {
  vi.resetModules();
  const module = await import('../../../vitest.config.js');
  return module.default as {
    test: { coverage: { thresholds?: Record<string, unknown> }; sequence: { sequencer: unknown } };
  };
}

describe('vitest.config.ts', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('enforces the 95% global and 100% stage-evidence floors when not in a shard', async () => {
    vi.stubEnv('PAQAD_TEST_SHARD', undefined);
    const config = await loadConfig();
    expect(config.test.coverage.thresholds).toEqual({
      branches: 95,
      functions: 95,
      lines: 95,
      statements: 95,
      'src/stage-evidence/**': { branches: 100, functions: 100, lines: 100, statements: 100 },
    });
  });

  it('enforces no thresholds inside a CI shard', async () => {
    vi.stubEnv('PAQAD_TEST_SHARD', '1');
    const config = await loadConfig();
    expect(config.test.coverage.thresholds).toBeUndefined();
  });

  it.each(['0', 'false', 'yes', ''])(
    'keeps the floors on when PAQAD_TEST_SHARD is %j, not exactly 1',
    async (value) => {
      vi.stubEnv('PAQAD_TEST_SHARD', value);
      const config = await loadConfig();
      expect(config.test.coverage.thresholds).toMatchObject({ branches: 95 });
    },
  );

  it('balances shards with the duration sequencer', async () => {
    const config = await loadConfig();
    const { DurationSequencer } = await import('../../shared/duration-sequencer.js');
    expect(config.test.sequence.sequencer).toBe(DurationSequencer);
  });
});
