import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';
import type { ReproducibilityStampPredicate } from '@/core/types/evidence-ledger.js';

import { CONTEXT_HASH_ALGO_VERSION } from '../context/context-hash.js';

export interface ReproducibilityStamp {
  context_hash: string;
  determinism: 'input-replay';
  algo_version: number;
  model_id?: string;
  provider?: string;
  sampling_params?: Record<string, unknown>;
  output_hash?: string;
  timestamp: string;
}

function stampPath(projectRoot: string): string {
  return join(projectRoot, PATHS.EVIDENCE_CONTEXT_STAMP);
}

export function recordReproducibilityStamp(projectRoot: string, stamp: ReproducibilityStamp): void {
  const target = stampPath(projectRoot);
  mkdirSync(dirname(target), { recursive: true });
  const tempPath = `${target}.tmp-${process.pid}`;
  writeFileSync(tempPath, `${JSON.stringify(stamp, null, 2)}\n`, 'utf8');
  renameSync(tempPath, target);
}

export function readReproducibilityStamp(projectRoot: string): ReproducibilityStamp | null {
  const path = stampPath(projectRoot);
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as ReproducibilityStamp;
    if (typeof parsed?.context_hash !== 'string' || parsed.context_hash.length === 0) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function readReproducibilityPredicate(
  projectRoot: string,
): ReproducibilityStampPredicate | null {
  const stamp = readReproducibilityStamp(projectRoot);
  if (stamp === null) return null;
  return {
    context_hash: stamp.context_hash,
    determinism: 'input-replay',
    algo_version: stamp.algo_version,
    replayable: true,
  };
}

export function buildReproducibilityStamp(
  contextHash: string,
  timestamp: string,
  output: Partial<
    Pick<ReproducibilityStamp, 'model_id' | 'provider' | 'sampling_params' | 'output_hash'>
  > = {},
): ReproducibilityStamp {
  return {
    context_hash: contextHash,
    determinism: 'input-replay',
    algo_version: CONTEXT_HASH_ALGO_VERSION,
    ...output,
    timestamp,
  };
}
