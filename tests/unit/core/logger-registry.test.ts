import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clearEngineLogger,
  engineLog,
  getConsumerLogger,
  setEngineLogger,
} from '@/core/logger-registry.js';
import type { EngineLogEntry, EngineLogger } from '@/core/types/logger.js';

/** Collects entries handed to an installed logger. */
function recordingLogger(): EngineLogger & { entries: EngineLogEntry[] } {
  const entries: EngineLogEntry[] = [];
  return {
    entries,
    log(entry) {
      entries.push(entry);
    },
  };
}

describe('logger-registry', () => {
  let stderr: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    clearEngineLogger();
    stderr.mockRestore();
  });

  describe('safe default (no logger installed)', () => {
    it('drops debug and info silently', () => {
      engineLog('debug', 'a debug line');
      engineLog('info', 'an info line', { k: 1 });
      expect(stderr).not.toHaveBeenCalled();
      expect(getConsumerLogger()).toBeNull();
    });

    it('writes warn and error to stderr', () => {
      engineLog('warn', 'a warning');
      engineLog('error', 'an error', { code: 'X' });
      expect(stderr).toHaveBeenCalledTimes(2);
      expect(stderr.mock.calls[0]?.[0]).toContain('a warning');
      expect(stderr.mock.calls[1]?.[0]).toContain('"code":"X"');
    });

    it('never throws when delivering a log', () => {
      expect(() => engineLog('error', 'boom')).not.toThrow();
    });
  });

  describe('delivery to an installed logger', () => {
    it('delivers level, message, and payload', () => {
      const logger = recordingLogger();
      setEngineLogger(logger);

      engineLog('warn', 'resume validation failed', { provider: 'voyage' });

      expect(logger.entries).toEqual([
        { level: 'warn', message: 'resume validation failed', payload: { provider: 'voyage' } },
      ]);
      // Routed to the consumer logger, not duplicated to stderr.
      expect(stderr).not.toHaveBeenCalled();
    });

    it('omits payload when none is supplied', () => {
      const logger = recordingLogger();
      setEngineLogger(logger);

      engineLog('info', 'no payload');

      expect(logger.entries).toEqual([{ level: 'info', message: 'no payload' }]);
    });

    it('exposes the installed logger via getConsumerLogger', () => {
      const logger = recordingLogger();
      setEngineLogger(logger);
      expect(getConsumerLogger()).toBe(logger);
    });
  });

  describe('fault isolation', () => {
    it('does not abort the caller, faults once, then falls through to stderr', () => {
      let calls = 0;
      const throwing: EngineLogger = {
        log() {
          calls += 1;
          throw new Error('logger exploded');
        },
      };
      setEngineLogger(throwing);

      expect(() => engineLog('warn', 'first')).not.toThrow();
      expect(() => engineLog('warn', 'second')).not.toThrow();

      // Logger is only called on the first fault; afterwards it is bypassed.
      expect(calls).toBe(1);
      // Exactly one fallback notice, plus the stderr default for each warn line.
      const notices = stderr.mock.calls.filter((c) =>
        String(c[0]).includes('consumer logger faulted'),
      );
      expect(notices).toHaveLength(1);
    });

    it('catches a rejected promise from an async logger', async () => {
      let rejecter: () => void = () => undefined;
      const pending = new Promise<void>((_, reject) => {
        rejecter = () => reject(new Error('async sink down'));
      });
      const asyncLogger: EngineLogger = {
        log: () => pending,
      };
      setEngineLogger(asyncLogger);

      // Two in-flight async calls share the same pending promise; when it
      // rejects, both rejection handlers run but only one notice is emitted.
      expect(() => engineLog('error', 'async one')).not.toThrow();
      expect(() => engineLog('error', 'async two')).not.toThrow();
      rejecter();
      await pending.catch(() => undefined);
      // Let the rejection handlers run.
      await Promise.resolve();
      await Promise.resolve();

      const notices = stderr.mock.calls.filter((c) =>
        String(c[0]).includes('consumer logger faulted'),
      );
      expect(notices).toHaveLength(1);
    });
  });

  describe('runtime swap', () => {
    it('routes subsequent logs only to the replacement logger', () => {
      const first = recordingLogger();
      const second = recordingLogger();

      setEngineLogger(first);
      engineLog('info', 'to-first');
      setEngineLogger(second);
      engineLog('info', 'to-second');

      expect(first.entries).toEqual([{ level: 'info', message: 'to-first' }]);
      expect(second.entries).toEqual([{ level: 'info', message: 'to-second' }]);
    });

    it('clearEngineLogger reverts to the safe default', () => {
      const logger = recordingLogger();
      setEngineLogger(logger);
      clearEngineLogger();

      engineLog('warn', 'after-clear');

      expect(logger.entries).toEqual([]);
      expect(getConsumerLogger()).toBeNull();
      expect(stderr.mock.calls[0]?.[0]).toContain('after-clear');
    });

    it('resets the fault flag so a fresh logger gets a clean slate', () => {
      const throwing: EngineLogger = {
        log() {
          throw new Error('boom');
        },
      };
      setEngineLogger(throwing);
      engineLog('warn', 'fault it');

      const healthy = recordingLogger();
      setEngineLogger(healthy);
      engineLog('warn', 'healthy line');

      expect(healthy.entries).toEqual([{ level: 'warn', message: 'healthy line' }]);
    });
  });

  describe('payload truncation', () => {
    it('passes a payload at or below the 8192-byte threshold through unchanged', () => {
      const logger = recordingLogger();
      setEngineLogger(logger);

      const small = { blob: 'x'.repeat(100) };
      engineLog('info', 'small', small);

      expect(logger.entries[0]?.payload).toEqual(small);
    });

    it('truncates a payload that serialises beyond the threshold', () => {
      const logger = recordingLogger();
      setEngineLogger(logger);

      const big = { blob: 'x'.repeat(9000) };
      engineLog('info', 'big', big);

      const payload = logger.entries[0]?.payload as Record<string, unknown>;
      expect(payload.__truncated).toBe(true);
      expect(typeof payload.summary).toBe('string');
      expect((payload.summary as string).length).toBeLessThanOrEqual(256);
    });

    it('truncates a non-serialisable (circular) payload', () => {
      const logger = recordingLogger();
      setEngineLogger(logger);

      const circular: Record<string, unknown> = {};
      circular.self = circular;
      engineLog('warn', 'circular', circular);

      const payload = logger.entries[0]?.payload as Record<string, unknown>;
      expect(payload.__truncated).toBe(true);
    });
  });

  describe('package entry re-export', () => {
    it('exposes the logger API from the main package barrel', async () => {
      const pkg = await import('@/index.js');
      expect(typeof pkg.setEngineLogger).toBe('function');
      expect(typeof pkg.clearEngineLogger).toBe('function');
      expect(typeof pkg.getConsumerLogger).toBe('function');
    });
  });
});
