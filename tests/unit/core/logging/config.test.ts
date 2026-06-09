import { getEngineLogger, loadLoggingConfig, reloadLoggingConfig } from '@/core/logging/config';
import { createLogger } from '@/core/logging/logger';
import { DEFAULT_REDACTION_ALLOWLIST } from '@/core/logging/redaction';

describe('loadLoggingConfig', () => {
  const original = process.env.PAQAD_LOG_LEVEL;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.PAQAD_LOG_LEVEL;
    } else {
      process.env.PAQAD_LOG_LEVEL = original;
    }
  });

  it('defaults to info with the engine runtime and default allowlist', () => {
    delete process.env.PAQAD_LOG_LEVEL;
    const config = loadLoggingConfig();
    expect(config).toEqual({
      level: 'info',
      runtime: 'engine',
      allowlist: DEFAULT_REDACTION_ALLOWLIST,
    });
  });

  it('reads a valid level from PAQAD_LOG_LEVEL', () => {
    process.env.PAQAD_LOG_LEVEL = 'debug';
    expect(loadLoggingConfig().level).toBe('debug');
  });

  it('ignores an invalid PAQAD_LOG_LEVEL and falls back to info', () => {
    process.env.PAQAD_LOG_LEVEL = 'verbose';
    expect(loadLoggingConfig().level).toBe('info');
  });

  it('lets explicit overrides win over the environment', () => {
    process.env.PAQAD_LOG_LEVEL = 'debug';
    const config = loadLoggingConfig({ level: 'error', runtime: 'desktop' });
    expect(config.level).toBe('error');
    expect(config.runtime).toBe('desktop');
  });
});

describe('reloadLoggingConfig', () => {
  it('applies a new config to the existing instance without dropping lines', () => {
    const written: string[] = [];
    const logger = createLogger({
      runtime: 'engine',
      level: 'warn',
      writeLine: (line) => written.push(line),
      now: () => '2026-06-08T00:00:00.000Z',
    });

    logger.info('dropped');
    expect(written).toHaveLength(0);

    reloadLoggingConfig(logger, {
      level: 'debug',
      runtime: 'engine',
      allowlist: ['credential'],
    });

    logger.debug('kept', { credential: 'x', other: 'y' });
    expect(written).toHaveLength(1);
    const record = JSON.parse(written[0]);
    expect(record).toMatchObject({
      level: 'debug',
      event: 'kept',
      credential: '[REDACTED]',
      other: 'y',
    });
  });
});

describe('getEngineLogger', () => {
  it('returns a stable singleton', () => {
    expect(getEngineLogger()).toBe(getEngineLogger());
  });
});
