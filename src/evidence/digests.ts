// Issue #118 — change-subject identity for the ledger and receipt.
//
// in-toto's `subject` wants per-artifact digests; a "change" spans many files.
// We resolve the open question (per-file vs merge SHA) in favour of *per-file
// digests*: the receipt carries one in-toto subject per changed file, and every
// ledger row is stamped with a single `subject_digest` that is a stable,
// order-independent hash *over* those per-file digests. So the rows share one
// change identity while the receipt keeps full per-file granularity.

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { EvidenceFileDigest } from '@/core/types/evidence-ledger.js';

function sha256Hex(input: string | Buffer): string {
  return createHash('sha256').update(input).digest('hex');
}

/** 64 zeros — the genesis previous-receipt hash and the empty-change subject. */
export const ZERO_DIGEST = '0'.repeat(64);

/**
 * SHA-256 each changed file's bytes. A file that cannot be read (deleted in the
 * change, or outside the tree) is hashed by its path string instead, mirroring
 * the audit-events fallback, so a row always has a stable subject. Results are
 * sorted by name for order-independence.
 */
export async function computeFileDigests(
  projectRoot: string,
  changedFiles: readonly string[],
): Promise<EvidenceFileDigest[]> {
  const digests = await Promise.all(
    changedFiles.map(async (name): Promise<EvidenceFileDigest> => {
      try {
        const bytes = await readFile(join(projectRoot, name));
        return { name, sha256: sha256Hex(bytes) };
      } catch {
        // Deleted/unreadable file: hash the path so the subject is still stable.
        return { name, sha256: sha256Hex(name) };
      }
    }),
  );
  return digests.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Fold the per-file digests into one change-subject digest. Order-independent
 * (inputs are sorted) and stable: identical changed content yields an identical
 * subject across runs. An empty change collapses to {@link ZERO_DIGEST}.
 */
export function computeChangeSubjectDigest(fileDigests: readonly EvidenceFileDigest[]): string {
  if (fileDigests.length === 0) return ZERO_DIGEST;
  const canonical = [...fileDigests]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((d) => `${d.name}:${d.sha256}`)
    .join('\n');
  return sha256Hex(canonical);
}
