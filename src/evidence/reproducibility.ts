// Issue #123 — the durable reproducibility stamp.
//
// The context hash (src/context/context-hash.ts) is computed during a session
// rebuild, but the receipt is projected later, at merge. This module is the
// thin durable bridge: a session records the latest stamp here, and receipt
// projection reads it back and folds it into the #118 receipt. Written
// atomically (temp + rename) so a crash never leaves a half-written stamp;
// read tolerantly so a malformed file degrades to "no stamp" rather than throwing.
//
// HONESTY: the stamp records `determinism: 'input-replay'`. It captures the
// frozen input the agent saw plus the recorded output identity, NOT a claim of
// bit-identical regeneration — a hosted LLM exposes no stable seed.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';
import type { ReproducibilityStampPredicate } from '@/core/types/evidence-ledger.js';

import { CONTEXT_HASH_ALGO_VERSION } from '../context/context-hash.js';

/**
 * The recorded stamp. `context_hash` + the input-replay claim are the durable
 * core; the recorded-output fields (model, provider, sampling, output digest)
 * capture the in-toto "products" side so the stamp pairs a frozen input with the
 * output it produced. All output fields are optional — absent until the live
 * session loop supplies them.
 */
export interface ReproducibilityStamp {
  context_hash: string;
  determinism: 'input-replay';
  algo_version: number;
  /** Recorded output identity (best-effort, declared by the session). */
  model_id?: string;
  provider?: string;
  sampling_params?: Record<string, unknown>;
  /** SHA-256 of the recorded model output, when captured. */
  output_hash?: string;
  /** ISO-8601 time the stamp was recorded. */
  timestamp: string;
}

function stampPath(projectRoot: string): string {
  return join(projectRoot, PATHS.EVIDENCE_CONTEXT_STAMP);
}

/** Record the latest reproducibility stamp for a change, atomically. */
export function recordReproducibilityStamp(projectRoot: string, stamp: ReproducibilityStamp): void {
  const target = stampPath(projectRoot);
  mkdirSync(dirname(target), { recursive: true });
  const tempPath = `${target}.tmp-${process.pid}`;
  writeFileSync(tempPath, `${JSON.stringify(stamp, null, 2)}\n`, 'utf8');
  renameSync(tempPath, target);
}

/** Read the latest stamp, or `null` when none was recorded or it is malformed. */
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

/**
 * Project the recorded stamp into the receipt predicate field. Returns `null`
 * when no stamp exists, so the predicate omits `reproducibility` and prior
 * receipts stay byte-identical.
 */
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

/** Build a stamp from a rebuild's context hash and optional recorded output. */
export function buildReproducibilityStamp(
  contextHash: string,
  timestamp: string,
  output: Partial<Pick<ReproducibilityStamp, 'model_id' | 'provider' | 'sampling_params' | 'output_hash'>> = {},
): ReproducibilityStamp {
  return {
    context_hash: contextHash,
    determinism: 'input-replay',
    algo_version: CONTEXT_HASH_ALGO_VERSION,
    ...output,
    timestamp,
  };
}
