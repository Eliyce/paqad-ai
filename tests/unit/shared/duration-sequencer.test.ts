import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { TestSpecification } from 'vitest/node';
import { BaseSequencer } from 'vitest/node';

import {
  DurationSequencer,
  type FileWeights,
  loadShardTimings,
  medianWeight,
  partitionByDuration,
  SHARD_TIMINGS_FILE,
  toRootRelativePosix,
} from '../../shared/duration-sequencer.js';

function fakeSuite(size: number): { paths: string[]; weights: FileWeights } {
  let seed = 654;
  const next = () => {
    seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
    return seed / 2_147_483_648;
  };
  const paths: string[] = [];
  const weights: FileWeights = {};
  for (let i = 0; i < size; i += 1) {
    const path = `tests/unit/area-${i % 37}/file-${String(i).padStart(4, '0')}.test.ts`;
    paths.push(path);
    weights[path] =
      i % 97 === 0 ? 60_000 + Math.round(next() * 60_000) : Math.round(next() * 3_000);
  }
  return { paths, weights };
}

function totalOf(shard: string[], weights: FileWeights): number {
  return shard.reduce((sum, path) => sum + weights[path], 0);
}

describe('partitionByDuration', () => {
  const { paths, weights } = fakeSuite(900);
  const total = paths.reduce((sum, path) => sum + weights[path], 0);
  const biggest = Math.max(...Object.values(weights));

  for (let count = 1; count <= 6; count += 1) {
    it(`puts every file in exactly one of ${count} shard(s)`, () => {
      const shards = partitionByDuration(paths, weights, count);
      expect(shards).toHaveLength(count);
      const placed = shards.flat();
      expect(placed).toHaveLength(paths.length);
      expect(new Set(placed)).toEqual(new Set(paths));
    });

    it(`gives the same split on every run for ${count} shard(s)`, () => {
      const first = partitionByDuration(paths, weights, count);
      const second = partitionByDuration([...paths].reverse(), { ...weights }, count);
      expect(second).toEqual(first);
    });

    it(`keeps the slowest of ${count} shard(s) within 10% of the ideal`, () => {
      const shards = partitionByDuration(paths, weights, count);
      const slowest = Math.max(...shards.map((shard) => totalOf(shard, weights)));
      expect(slowest).toBeLessThanOrEqual(Math.max((total / count) * 1.1, biggest));
    });
  }

  it('lets one huge file fill a shard on its own', () => {
    const shards = partitionByDuration(
      ['a.test.ts', 'b.test.ts', 'c.test.ts', 'huge.test.ts'],
      { 'a.test.ts': 10, 'b.test.ts': 10, 'c.test.ts': 10, 'huge.test.ts': 1_000 },
      2,
    );
    expect(shards).toEqual([['huge.test.ts'], ['a.test.ts', 'b.test.ts', 'c.test.ts']]);
  });

  it('gives a file with no timing the median weight', () => {
    const shards = partitionByDuration(
      ['new.test.ts', 'a.test.ts', 'b.test.ts', 'c.test.ts'],
      { 'a.test.ts': 100, 'b.test.ts': 50, 'c.test.ts': 10 },
      2,
    );
    expect(shards).toEqual([
      ['a.test.ts', 'c.test.ts'],
      ['b.test.ts', 'new.test.ts'],
    ]);
  });

  it('breaks weight ties by path', () => {
    const shards = partitionByDuration(['b', 'a', 'c'], { a: 5, b: 5, c: 5 }, 3);
    expect(shards).toEqual([['a'], ['b'], ['c']]);
  });

  it('places a path listed twice only once', () => {
    expect(partitionByDuration(['a', 'a', 'b'], { a: 1, b: 1 }, 2)).toEqual([['a'], ['b']]);
  });

  it('treats a shard count below one as one shard', () => {
    expect(partitionByDuration(['a', 'b'], { a: 1, b: 2 }, 0)).toEqual([['b', 'a']]);
  });
});

describe('medianWeight', () => {
  it('takes the middle value of an odd list and the mean of the middle pair of an even one', () => {
    expect(medianWeight({ a: 3, b: 1, c: 2 })).toBe(2);
    expect(medianWeight({ a: 4, b: 1, c: 2, d: 3 })).toBe(2.5);
  });

  it('is zero with no weights', () => {
    expect(medianWeight({})).toBe(0);
  });
});

describe('loadShardTimings', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-shard-timings-'));
    mkdirSync(join(root, 'tests'), { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  const write = (content: string) => writeFileSync(join(root, SHARD_TIMINGS_FILE), content);

  it('returns this OS block', () => {
    write(JSON.stringify({ linux: { 'a.test.ts': 5 }, win32: { 'a.test.ts': 9 } }));
    expect(loadShardTimings(root, 'win32')).toEqual({ 'a.test.ts': 9 });
  });

  it('returns null when the file is missing', () => {
    expect(loadShardTimings(root, 'linux')).toBeNull();
  });

  it.each([
    ['not JSON', '{ nope'],
    ['an array', '[]'],
    ['null', 'null'],
    ['no block for this OS', JSON.stringify({ darwin: { a: 1 } })],
    ['a block that is not an object', JSON.stringify({ linux: [1] })],
    ['an empty block', JSON.stringify({ linux: {} })],
    ['a weight that is not a number', JSON.stringify({ linux: { a: '5' } })],
    ['a negative weight', JSON.stringify({ linux: { a: -1 } })],
  ])('returns null for %s', (_label, content) => {
    write(content);
    expect(loadShardTimings(root, 'linux')).toBeNull();
  });
});

describe('toRootRelativePosix', () => {
  it('gives a root-relative path with forward slashes', () => {
    const root = join(tmpdir(), 'repo');
    expect(toRootRelativePosix(root, join(root, 'tests', 'unit', 'a.test.ts'))).toBe(
      'tests/unit/a.test.ts',
    );
  });
});

describe('DurationSequencer', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-duration-sequencer-'));
    mkdirSync(join(root, 'tests'), { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  const paths = ['tests/a.test.ts', 'tests/b.test.ts', 'tests/c.test.ts', 'tests/d.test.ts'];
  const specs = () =>
    paths.map((path) => ({ moduleId: join(root, path) }) as unknown as TestSpecification);
  const sequencer = (shard?: { index: number; count: number }) =>
    new DurationSequencer({ config: { root, shard } } as never);
  const names = (files: TestSpecification[]) =>
    files.map((spec) => toRootRelativePosix(root, spec.moduleId));

  it('splits by duration when this OS has timings', async () => {
    writeFileSync(
      join(root, SHARD_TIMINGS_FILE),
      JSON.stringify({
        [process.platform]: {
          'tests/a.test.ts': 900,
          'tests/b.test.ts': 100,
          'tests/c.test.ts': 100,
          'tests/d.test.ts': 100,
        },
      }),
    );
    expect(names(await sequencer({ index: 1, count: 2 }).shard(specs()))).toEqual([
      'tests/a.test.ts',
    ]);
    expect(names(await sequencer({ index: 2, count: 2 }).shard(specs()))).toEqual([
      'tests/b.test.ts',
      'tests/c.test.ts',
      'tests/d.test.ts',
    ]);
  });

  it('returns no files for a shard index past the shard list', async () => {
    writeFileSync(
      join(root, SHARD_TIMINGS_FILE),
      JSON.stringify({ [process.platform]: { 'tests/a.test.ts': 1 } }),
    );
    expect(await sequencer({ index: 3, count: 2 }).shard(specs())).toEqual([]);
  });

  it('falls back to the built-in split when the timings file is missing', async () => {
    for (const index of [1, 2]) {
      const ours = await sequencer({ index, count: 2 }).shard(specs());
      const builtIn = await new BaseSequencer({
        config: { root, shard: { index, count: 2 } },
      } as never).shard(specs());
      expect(names(ours)).toEqual(names(builtIn));
    }
  });

  it('falls back to the built-in split when the timings file is invalid', async () => {
    writeFileSync(join(root, SHARD_TIMINGS_FILE), '{ broken');
    const ours = await sequencer({ index: 1, count: 2 }).shard(specs());
    const builtIn = await new BaseSequencer({
      config: { root, shard: { index: 1, count: 2 } },
    } as never).shard(specs());
    expect(names(ours)).toEqual(names(builtIn));
  });

  it('defers to the built-in shard when no shard config is set', async () => {
    writeFileSync(
      join(root, SHARD_TIMINGS_FILE),
      JSON.stringify({ [process.platform]: { 'tests/a.test.ts': 1 } }),
    );
    const builtIn = new BaseSequencer({ config: { root } } as never).shard(specs());
    await expect(builtIn).rejects.toThrow();
    await expect(sequencer().shard(specs())).rejects.toThrow();
  });
});
