import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

/**
 * Build an artifact to a unique temp path, then atomically swap it into place
 * with a single `rename`. A reader of `targetPath` therefore only ever sees a
 * complete previous artifact or a complete new one — never a half-written file.
 *
 * This is the canonical "build-to-temp then atomic swap" primitive for the
 * background harness (F1); F8/F9 build the embedding cache and vector index
 * through it. The temp name includes the pid plus a per-call counter so two
 * builders (a stale worker racing a reclaimed one) cannot collide on the temp
 * file even if the single-flight lock is bypassed.
 *
 * @param targetPath absolute path the finished artifact should live at.
 * @param build receives the temp path; must fully write it before returning.
 */
export async function buildAndSwap(
  targetPath: string,
  build: (tempPath: string) => Promise<void>,
): Promise<void> {
  await mkdir(dirname(targetPath), { recursive: true });
  const tempPath = `${targetPath}.tmp.${process.pid}.${nextTempSeq()}`;
  await build(tempPath);
  await rename(tempPath, targetPath);
}

/**
 * Write `content` to `targetPath` atomically (temp-then-rename). The convenience
 * wrapper over {@link buildAndSwap} for the common "I already have the bytes"
 * case.
 */
export async function atomicWriteFile(targetPath: string, content: string): Promise<void> {
  await buildAndSwap(targetPath, (tempPath) => writeFile(tempPath, content, 'utf8'));
}

let tempSeq = 0;

/** Monotonic per-process counter so concurrent builds get distinct temp names. */
function nextTempSeq(): number {
  tempSeq = (tempSeq + 1) % Number.MAX_SAFE_INTEGER;
  return tempSeq;
}
