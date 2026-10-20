import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { EvidenceFileDigest } from '@/core/types/evidence-ledger.js';

function sha256Hex(input: string | Buffer): string {
  return createHash('sha256').update(input).digest('hex');
}

export const ZERO_DIGEST = '0'.repeat(64);

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
        return { name, sha256: sha256Hex(name) };
      }
    }),
  );
  return digests.sort((a, b) => a.name.localeCompare(b.name));
}

export function computeChangeSubjectDigest(fileDigests: readonly EvidenceFileDigest[]): string {
  if (fileDigests.length === 0) return ZERO_DIGEST;
  const canonical = [...fileDigests]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((d) => `${d.name}:${d.sha256}`)
    .join('\n');
  return sha256Hex(canonical);
}
