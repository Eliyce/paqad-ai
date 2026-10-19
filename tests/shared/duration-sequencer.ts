// Vitest sequencer that splits `--shard` runs by how long each test file takes (issue #654).
//
// Vitest's own `--shard` hashes each file path and cuts the list into equal file counts, so one
// slow file can pile onto a shard that already has its share. This sequencer reads per-OS file
// timings from `tests/shard-timings.json` and hands out files longest first, each to the shard
// with the least work so far. It only changes which shard gets which file: `sort` is untouched,
// and an unsharded run (local `pnpm run ci`) never calls `shard` at all.
//
// A stale timings file can only make the shards less even. It can never skip or repeat a test,
// because every file Vitest hands in lands in exactly one shard. A missing or broken file falls
// back to Vitest's built-in split.

import { existsSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import type { TestSpecification } from 'vitest/node';
import { BaseSequencer } from 'vitest/node';

/** Root-relative posix test file path to milliseconds, for one OS. */
export type FileWeights = Record<string, number>;

export const SHARD_TIMINGS_FILE = 'tests/shard-timings.json';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Reads this OS's block of `tests/shard-timings.json`. Returns null when the file is missing,
 * is not valid JSON, has no block for this OS, the block is empty, or any weight is not a
 * finite number of zero or more. Null means "use Vitest's built-in split".
 */
export function loadShardTimings(root: string, platform: string): FileWeights | null {
  const file = join(root, SHARD_TIMINGS_FILE);
  if (!existsSync(file)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
  if (!isPlainObject(parsed)) return null;
  const block = parsed[platform];
  if (!isPlainObject(block)) return null;
  const values = Object.values(block);
  if (values.length === 0) return null;
  for (const ms of values) {
    if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return null;
  }
  return block as FileWeights;
}

/** The median of the known weights, used for a test file the timings do not list yet. */
export function medianWeight(weights: FileWeights): number {
  const values = Object.values(weights).sort((a, b) => a - b);
  if (values.length === 0) return 0;
  const mid = Math.floor(values.length / 2);
  return values.length % 2 === 1 ? values[mid] : (values[mid - 1] + values[mid]) / 2;
}

/**
 * Splits `paths` into `count` shards, greedy longest first: heaviest file first (ties broken by
 * path so the split is the same every run), each to the shard with the smallest total so far
 * (ties to the lower shard). A path with no weight gets the median. Every path lands in exactly
 * one shard; a path listed twice is placed once.
 */
export function partitionByDuration(
  paths: readonly string[],
  weights: FileWeights,
  count: number,
): string[][] {
  const shards: string[][] = Array.from({ length: Math.max(1, count) }, () => []);
  const totals = shards.map(() => 0);
  const fallback = medianWeight(weights);
  const unique = [...new Set(paths)].map((path) => ({
    path,
    weight: Object.hasOwn(weights, path) ? weights[path] : fallback,
  }));
  unique.sort((a, b) =>
    a.weight !== b.weight ? b.weight - a.weight : a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
  );
  for (const { path, weight } of unique) {
    let lightest = 0;
    for (let i = 1; i < totals.length; i += 1) {
      if (totals[i] < totals[lightest]) lightest = i;
    }
    shards[lightest].push(path);
    totals[lightest] += weight;
  }
  return shards;
}

/** A test file's path relative to the project root, with forward slashes on every OS. */
export function toRootRelativePosix(root: string, moduleId: string): string {
  return relative(root, moduleId).split('\\').join('/');
}

export class DurationSequencer extends BaseSequencer {
  override async shard(files: TestSpecification[]): Promise<TestSpecification[]> {
    const { root, shard } = this.ctx.config;
    const weights = loadShardTimings(root, process.platform);
    if (!weights || !shard) return super.shard(files);
    const pathOf = (spec: TestSpecification) => toRootRelativePosix(root, spec.moduleId);
    const shards = partitionByDuration(files.map(pathOf), weights, shard.count);
    const mine = new Set(shards[shard.index - 1] ?? []);
    return files.filter((spec) => mine.has(pathOf(spec)));
  }
}
