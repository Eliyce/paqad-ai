import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  CacheMetricsTracker,
  CacheWarmer,
  DEFAULT_PREDICTIVE_CACHE_OPTIONS,
  PredictiveCache,
  TransitionLogManager,
} from '@/cache/index.js';

describe('CacheMetricsTracker', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-cache-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('returns defaults and persists metric increments', async () => {
    const tracker = new CacheMetricsTracker(root);

    expect(await tracker.read('session-1')).toEqual({
      session_id: 'session-1',
      cache_hits: 0,
      cache_misses: 0,
      prewarm_hits: 0,
      prewarm_misses: 0,
      prewarm_skipped: 0,
      total_token_savings_estimate: 0,
    });

    await tracker.record('session-1', 'cache_hit', 50);
    await tracker.record('session-1', 'prewarm_miss');

    expect(await tracker.read('session-1')).toEqual({
      session_id: 'session-1',
      cache_hits: 1,
      cache_misses: 0,
      prewarm_hits: 0,
      prewarm_misses: 1,
      prewarm_skipped: 0,
      total_token_savings_estimate: 50,
    });
  });
});

describe('TransitionLogManager', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-transition-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('appends entries, evicts old ones, and computes transition probabilities', async () => {
    const manager = new TransitionLogManager(root, 2);

    await manager.append({
      timestamp: '2024-01-01T00:00:00.000Z',
      workflow: 'implementation',
      stack_key: 'react',
      from_skill: 'plan',
      to_skill: 'code',
      from_outputs_hash: 'a',
    });
    await manager.append({
      timestamp: '2024-01-01T00:01:00.000Z',
      workflow: 'implementation',
      stack_key: 'react',
      from_skill: 'plan',
      to_skill: 'code',
      from_outputs_hash: 'b',
    });
    await manager.append({
      timestamp: '2024-01-01T00:02:00.000Z',
      workflow: 'implementation',
      stack_key: 'react',
      from_skill: 'plan',
      to_skill: 'test',
      from_outputs_hash: 'c',
    });

    const stored = JSON.parse(
      readFileSync(join(root, '.paqad', 'cache', 'transition-log.json'), 'utf8'),
    );
    expect(stored.entries.react).toHaveLength(2);

    await expect(manager.computeProbabilities('react', 'plan')).resolves.toEqual([
      { to_skill: 'code', probability: 0.5 },
      { to_skill: 'test', probability: 0.5 },
    ]);
    await expect(manager.computeProbabilities('react', 'missing')).resolves.toEqual([]);
  });
});

describe('CacheWarmer', () => {
  it('skips existing cached entries and writes prewarm placeholders for misses', async () => {
    const checkCache = vi
      .fn()
      .mockResolvedValueOnce({ hit: true })
      .mockResolvedValueOnce({ hit: false });
    const writeCache = vi.fn().mockResolvedValue(undefined);
    const computeInputHash = vi.fn().mockResolvedValue('abc123hash');
    const warmer = new CacheWarmer({ checkCache, writeCache, computeInputHash } as never);

    await expect(warmer.prewarm('skill-a', ['b.ts', 'a.ts'])).resolves.toBe(false);
    await expect(warmer.prewarm('skill-a', ['b.ts', 'a.ts'])).resolves.toBe(true);

    // computeInputHash should only be called for the miss (not the hit)
    expect(computeInputHash).toHaveBeenCalledTimes(1);
    expect(computeInputHash).toHaveBeenCalledWith(['b.ts', 'a.ts']);

    expect(writeCache).toHaveBeenCalledWith('skill-a', 'abc123hash', '[prewarm-pending]', [
      'b.ts',
      'a.ts',
    ]);
  });

  it('uses the hash returned by computeInputHash, not a path-only hash', async () => {
    const contentBasedHash = 'content-driven-hash-value-from-manager';
    const checkCache = vi.fn().mockResolvedValue({ hit: false });
    const writeCache = vi.fn().mockResolvedValue(undefined);
    const computeInputHash = vi.fn().mockResolvedValue(contentBasedHash);
    const warmer = new CacheWarmer({ checkCache, writeCache, computeInputHash } as never);

    await warmer.prewarm('skill-b', ['file.ts']);

    // The hash passed to writeCache must be exactly what computeInputHash returned,
    // ensuring runtime checkCache (which also calls computeInputHash) will find the entry.
    expect(writeCache).toHaveBeenCalledWith('skill-b', contentBasedHash, '[prewarm-pending]', [
      'file.ts',
    ]);
  });

  it('returns false when cache operations throw', async () => {
    const warmer = new CacheWarmer({
      checkCache: vi.fn().mockRejectedValue(new Error('boom')),
      writeCache: vi.fn(),
    } as never);

    await expect(warmer.prewarm('skill-a', ['a.ts'])).resolves.toBe(false);
  });

  it('returns false when computeInputHash throws', async () => {
    const warmer = new CacheWarmer({
      checkCache: vi.fn().mockResolvedValue({ hit: false }),
      computeInputHash: vi.fn().mockRejectedValue(new Error('hash-fail')),
      writeCache: vi.fn(),
    } as never);

    await expect(warmer.prewarm('skill-a', ['a.ts'])).resolves.toBe(false);
  });
});

describe('PredictiveCache', () => {
  it('is enabled by default', () => {
    expect(DEFAULT_PREDICTIVE_CACHE_OPTIONS.enabled).toBe(true);
  });

  it('records transitions but exits early when predictive caching is disabled', async () => {
    const transitionLog = {
      append: vi.fn().mockResolvedValue(undefined),
      computeProbabilities: vi.fn(),
    };
    const warmer = { prewarm: vi.fn() };
    const metrics = { record: vi.fn() };
    const cache = new PredictiveCache(transitionLog as never, warmer as never, metrics as never, {
      enabled: false,
      confidence_threshold: 0.7,
      max_candidates: 3,
    });

    await cache.onSkillComplete('session-1', 'react', 'implementation', 'plan', 'hash', 'code');

    expect(transitionLog.append).toHaveBeenCalled();
    expect(transitionLog.computeProbabilities).not.toHaveBeenCalled();
  });

  it('prewarms only high-confidence candidates and records hit, skipped, and miss outcomes', async () => {
    const transitionLog = {
      append: vi.fn().mockResolvedValue(undefined),
      computeProbabilities: vi.fn().mockResolvedValue([
        { to_skill: 'code', probability: 0.9 },
        { to_skill: 'docs', probability: 0.8 },
        { to_skill: 'review', probability: 0.4 },
      ]),
    };
    const warmer = {
      prewarm: vi
        .fn()
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false)
        .mockRejectedValueOnce(new Error('fail')),
    };
    const metrics = { record: vi.fn().mockResolvedValue(undefined) };
    const cache = new PredictiveCache(transitionLog as never, warmer as never, metrics as never, {
      enabled: true,
      confidence_threshold: 0.4,
      max_candidates: 3,
    });

    await cache.onSkillComplete('session-1', 'react', 'implementation', 'plan', 'hash');

    expect(transitionLog.append).not.toHaveBeenCalled();
    expect(transitionLog.computeProbabilities).toHaveBeenCalledWith('react', 'plan');
    expect(warmer.prewarm).toHaveBeenCalledTimes(3);
    expect(metrics.record.mock.calls).toEqual([
      ['session-1', 'prewarm_hit'],
      ['session-1', 'prewarm_skipped'],
      ['session-1', 'prewarm_miss'],
    ]);
  });

  it('computes stable output hashes', () => {
    expect(PredictiveCache.computeOutputHash('output')).toBe(
      PredictiveCache.computeOutputHash('output'),
    );
    expect(PredictiveCache.computeOutputHash('output')).not.toBe(
      PredictiveCache.computeOutputHash('different'),
    );
  });
});
