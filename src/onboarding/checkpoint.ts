import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';
import { toPosixPath } from '@/core/path-utils.js';

/**
 * Onboarding resume checkpoint (PQD-424, AC3).
 *
 * Records the project-relative paths already written during an onboarding run so
 * that a subsequent run — after the first was killed mid-flight — re-enters,
 * skips the files it already produced, and writes only the unwritten remainder.
 * The file is deleted once onboarding completes cleanly, so on a normal run it
 * is transient and absent on disk afterwards.
 */
interface OnboardingCheckpoint {
  /** Schema version of the checkpoint payload itself. */
  schema_version: 1;
  /** Project-relative (POSIX) paths already written this onboarding. */
  written: string[];
}

/**
 * Atomically persist the set of completed file paths. Paths are normalised to
 * POSIX so the skip comparison on resume is platform-independent (the same
 * normalisation `writeGeneratedFiles` applies to its reported paths). Writing
 * via a temp file + rename keeps the checkpoint from being observed half-written
 * if the process dies during the write itself.
 */
export function writeOnboardingCheckpoint(projectRoot: string, writtenPaths: string[]): void {
  const target = join(projectRoot, PATHS.ONBOARDING_CHECKPOINT);
  mkdirSync(dirname(target), { recursive: true });

  const payload: OnboardingCheckpoint = {
    schema_version: 1,
    written: dedupePreservingOrder(writtenPaths.map(toPosixPath)),
  };

  const tmp = `${target}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  renameSync(tmp, target);
}

/**
 * Read the completed-path list from a prior interrupted run, or `null` when no
 * checkpoint exists (the common, clean-start case). A malformed or unreadable
 * checkpoint is treated as absent — onboarding is idempotent, so re-writing the
 * full set is safe and strictly better than refusing to resume.
 */
export function readOnboardingCheckpoint(projectRoot: string): string[] | null {
  const target = join(projectRoot, PATHS.ONBOARDING_CHECKPOINT);
  if (!existsSync(target)) {
    return null;
  }

  try {
    const parsed = JSON.parse(readFileSync(target, 'utf8')) as Partial<OnboardingCheckpoint>;
    if (!Array.isArray(parsed.written)) {
      return null;
    }
    return parsed.written.filter((entry): entry is string => typeof entry === 'string');
  } catch {
    return null;
  }
}

/**
 * Remove the checkpoint once onboarding has finished. Tolerates an absent file
 * so the clean-run path (where no checkpoint was ever lingering) is a no-op.
 */
export function deleteOnboardingCheckpoint(projectRoot: string): void {
  rmSync(join(projectRoot, PATHS.ONBOARDING_CHECKPOINT), { force: true });
}

function dedupePreservingOrder(paths: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const path of paths) {
    if (!seen.has(path)) {
      seen.add(path);
      result.push(path);
    }
  }
  return result;
}
