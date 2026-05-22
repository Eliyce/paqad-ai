import { afterEach, describe, expect, it, vi } from 'vitest';

const { mockReadFile, mockStat } = vi.hoisted(() => ({
  mockReadFile: vi.fn(),
  mockStat: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
  readFile: mockReadFile,
  stat: mockStat,
}));

import { FreshnessChecker } from '@/project-knowledge/freshness-checker.js';

afterEach(() => {
  vi.clearAllMocks();
});

describe('FreshnessChecker', () => {
  const checker = new FreshnessChecker();
  const projectRoot = '/tmp/project';

  it('returns unknown note when doc-progress.json does not exist', async () => {
    mockReadFile.mockRejectedValue(new Error('ENOENT'));

    const result = await checker.check(projectRoot, []);

    expect(result.note).toContain('run paqad-ai onboard');
    expect(result.generated_at).toBeUndefined();
    expect(result.drift_detected).toBe(false);
    expect(result.stale_sources).toEqual([]);
  });

  it('reads generated_at from doc-progress.json', async () => {
    mockReadFile.mockImplementation((p: string) => {
      if ((p as string).includes('doc-progress')) {
        return Promise.resolve(JSON.stringify({ generated_at: '2026-01-01T00:00:00.000Z' }));
      }
      return Promise.reject(new Error('ENOENT'));
    });

    const result = await checker.check(projectRoot, []);

    expect(result.generated_at).toBe('2026-01-01T00:00:00.000Z');
    expect(result.note).toBeUndefined();
  });

  it('sets drift_detected true when stack-drift.json has keys', async () => {
    mockReadFile.mockImplementation((p: string) => {
      if ((p as string).includes('doc-progress')) {
        return Promise.resolve(JSON.stringify({ generated_at: '2026-01-01T00:00:00.000Z' }));
      }
      if ((p as string).includes('stack-drift')) {
        return Promise.resolve(JSON.stringify({ node: { expected: '18', found: '20' } }));
      }
      return Promise.reject(new Error('ENOENT'));
    });

    const result = await checker.check(projectRoot, []);

    expect(result.drift_detected).toBe(true);
  });

  it('does not set drift_detected when stack-drift.json is empty object', async () => {
    mockReadFile.mockImplementation((p: string) => {
      if ((p as string).includes('doc-progress')) {
        return Promise.resolve(JSON.stringify({ generated_at: '2026-01-01T00:00:00.000Z' }));
      }
      if ((p as string).includes('stack-drift')) {
        return Promise.resolve(JSON.stringify({}));
      }
      return Promise.reject(new Error('ENOENT'));
    });

    const result = await checker.check(projectRoot, []);

    expect(result.drift_detected).toBe(false);
  });

  it('marks evidence file as stale when its mtime postdates generated_at by >24h', async () => {
    const generatedAt = '2026-03-01T12:00:00.000Z';
    const staleMtime = new Date('2026-03-04T00:00:00.000Z').getTime();

    mockReadFile.mockImplementation((p: string) => {
      if ((p as string).includes('doc-progress')) {
        return Promise.resolve(JSON.stringify({ generated_at: generatedAt }));
      }
      return Promise.reject(new Error('ENOENT'));
    });
    mockStat.mockResolvedValue({ mtimeMs: staleMtime });

    const result = await checker.check(projectRoot, ['docs/modules/foo.md']);

    expect(result.stale_sources).toContain('docs/modules/foo.md');
  });

  it('does not mark fresh evidence as stale', async () => {
    const generatedAt = '2026-03-01T12:00:00.000Z';
    const freshMtime = new Date('2026-03-02T00:00:00.000Z').getTime();

    mockReadFile.mockImplementation((p: string) => {
      if ((p as string).includes('doc-progress')) {
        return Promise.resolve(JSON.stringify({ generated_at: generatedAt }));
      }
      return Promise.reject(new Error('ENOENT'));
    });
    mockStat.mockResolvedValue({ mtimeMs: freshMtime });

    const result = await checker.check(projectRoot, ['docs/modules/foo.md']);

    expect(result.stale_sources).toEqual([]);
  });

  it('does not mark older evidence as stale just because it predates generated_at', async () => {
    const generatedAt = '2026-03-05T12:00:00.000Z';
    const olderMtime = new Date('2026-03-03T00:00:00.000Z').getTime();

    mockReadFile.mockImplementation((p: string) => {
      if ((p as string).includes('doc-progress')) {
        return Promise.resolve(JSON.stringify({ generated_at: generatedAt }));
      }
      return Promise.reject(new Error('ENOENT'));
    });
    mockStat.mockResolvedValue({ mtimeMs: olderMtime });

    const result = await checker.check(projectRoot, ['docs/modules/foo.md']);

    expect(result.stale_sources).toEqual([]);
  });

  it('skips evidence files that cannot be stat-ted', async () => {
    mockReadFile.mockImplementation((p: string) => {
      if ((p as string).includes('doc-progress')) {
        return Promise.resolve(JSON.stringify({ generated_at: '2026-03-01T12:00:00.000Z' }));
      }
      return Promise.reject(new Error('ENOENT'));
    });
    mockStat.mockRejectedValue(new Error('ENOENT'));

    const result = await checker.check(projectRoot, ['docs/missing.md']);

    expect(result.stale_sources).toEqual([]);
  });

  it('does not check staleness when no generated_at is available', async () => {
    mockReadFile.mockRejectedValue(new Error('ENOENT'));
    mockStat.mockResolvedValue({ mtimeMs: 0 });

    const result = await checker.check(projectRoot, ['docs/modules/foo.md']);

    expect(result.stale_sources).toEqual([]);
    expect(mockStat).not.toHaveBeenCalled();
  });
});
