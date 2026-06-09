import { createLogger, type StructuredLogger } from '@/core/logging/logger';
import {
  DEFAULT_REDACTION_ALLOWLIST,
  REDACTION_PLACEHOLDER,
  redactFields,
} from '@/core/logging/redaction';

interface Harness {
  logger: StructuredLogger;
  lines: () => Record<string, unknown>[];
  raw: () => string[];
}

function harness(overrides: Partial<Parameters<typeof createLogger>[0]> = {}): Harness {
  const written: string[] = [];
  const logger = createLogger({
    runtime: 'engine',
    now: () => '2026-06-08T00:00:00.000Z',
    writeLine: (line) => written.push(line),
    ...overrides,
  });
  return {
    logger,
    raw: () => written,
    lines: () => written.map((line) => JSON.parse(line) as Record<string, unknown>),
  };
}

describe('createLogger', () => {
  it('emits a structured JSON line per call', () => {
    const h = harness();
    h.logger.info('test.event', { key: 'value' });

    expect(h.raw()[0].endsWith('\n')).toBe(true);
    const record = h.lines()[0];
    expect(record).toMatchObject({
      level: 'info',
      timestamp: '2026-06-08T00:00:00.000Z',
      runtime: 'engine',
      event: 'test.event',
      key: 'value',
    });
  });

  it('redacts allowlisted fields at the top level and counts them', () => {
    const h = harness();
    h.logger.info('redaction.test', { credential: 'secret123', safe: 'ok' });

    const record = h.lines()[0];
    expect(record.credential).toBe(REDACTION_PLACEHOLDER);
    expect(record.safe).toBe('ok');
    expect(h.logger.getRedactionCount()).toBe(1);
  });

  it('redacts allowlisted fields one level deep in nested objects', () => {
    const h = harness();
    h.logger.info('nested.test', { outer: { prompt: 'user text', safe: 'fine' } });

    const record = h.lines()[0];
    expect(record.outer).toEqual({ prompt: REDACTION_PLACEHOLDER, safe: 'fine' });
    expect(h.logger.getRedactionCount()).toBe(1);
  });

  it('suppresses lines below the level threshold', () => {
    const h = harness({ level: 'warn' });
    h.logger.info('ignored');
    h.logger.debug('ignored');
    expect(h.raw()).toHaveLength(0);

    h.logger.warn('kept');
    expect(h.raw()).toHaveLength(1);
  });

  it('resets the redaction counter on demand', () => {
    const h = harness();
    h.logger.info('a', { credential: 'x' });
    expect(h.logger.getRedactionCount()).toBe(1);
    h.logger.resetRedactionCount();
    expect(h.logger.getRedactionCount()).toBe(0);
  });

  it('changes level in place without re-emitting prior lines', () => {
    const h = harness({ level: 'warn' });
    h.logger.warn('before');
    expect(h.raw()).toHaveLength(1);

    h.logger.setLevel('debug');
    h.logger.debug('after');

    const events = h.lines().map((r) => r.event);
    expect(events).toEqual(['before', 'after']);
  });

  it('applies a replacement allowlist via setAllowlist', () => {
    const h = harness();
    h.logger.setAllowlist(['token']);
    h.logger.info('swap', { token: 'abc', credential: 'kept' });

    const record = h.lines()[0];
    expect(record.token).toBe(REDACTION_PLACEHOLDER);
    expect(record.credential).toBe('kept');
  });

  it('stamps a shared correlation id on every line via withCorrelation', () => {
    const h = harness();
    const run = h.logger.withCorrelation('corr-1');
    run.info('phase.a');
    run.warn('phase.b');
    run.error('phase.c', { credential: 'z' });

    const records = h.lines();
    expect(records.map((r) => r.correlation_id)).toEqual(['corr-1', 'corr-1', 'corr-1']);
    // Shares the parent's redaction counter.
    expect(h.logger.getRedactionCount()).toBe(1);
  });

  it('routes through the log() method for an explicit level', () => {
    const h = harness();
    h.logger.log('error', 'explicit');
    expect(h.lines()[0]).toMatchObject({ level: 'error', event: 'explicit' });
  });

  it('defaults level to info, allowlist to the default, and writes to stdout', () => {
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      const logger = createLogger({ runtime: 'engine' });
      logger.debug('dropped');
      logger.info('kept', { prompt: 'secret' });

      expect(writeSpy).toHaveBeenCalledTimes(1);
      const record = JSON.parse(String(writeSpy.mock.calls[0][0]));
      expect(record).toMatchObject({ level: 'info', event: 'kept', prompt: REDACTION_PLACEHOLDER });
      expect(typeof record.timestamp).toBe('string');
    } finally {
      writeSpy.mockRestore();
    }
  });
});

describe('redactFields', () => {
  it('leaves arrays and primitives untouched', () => {
    const { redacted, count } = redactFields(
      { list: ['a', 'b'], n: 1, credential: 'x' },
      DEFAULT_REDACTION_ALLOWLIST,
    );
    expect(redacted).toEqual({ list: ['a', 'b'], n: 1, credential: REDACTION_PLACEHOLDER });
    expect(count).toBe(1);
  });
});
