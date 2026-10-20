import { existsSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import type { TestSpecification } from 'vitest/node';
import { BaseSequencer } from 'vitest/node';

export type FileWeights = Record<string, number>;

export const SHARD_TIMINGS_FILE = 'tests/shard-timings.json';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

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

export function medianWeight(weights: FileWeights): number {
  const values = Object.values(weights).sort((a, b) => a - b);
  if (values.length === 0) return 0;
  const mid = Math.floor(values.length / 2);
  return values.length % 2 === 1 ? values[mid] : (values[mid - 1] + values[mid]) / 2;
}

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
