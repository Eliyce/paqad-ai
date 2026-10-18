import { afterEach, describe, expect, it, vi } from 'vitest';

// The coverage floors apply only to a whole-suite run (issue #654): CI shards set
// PAQAD_TEST_SHARD=1 and check none, the merge run and local `pnpm run ci` check them all.
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

  it('balances shards with the duration sequencer', async () => {
    const config = await loadConfig();
    // Module reset loads a fresh copy of the class, so compare it with the copy the config saw.
    const { DurationSequencer } = await import('../../shared/duration-sequencer.js');
    expect(config.test.sequence.sequencer).toBe(DurationSequencer);
  });
});
