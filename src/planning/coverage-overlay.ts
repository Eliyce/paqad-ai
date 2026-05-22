import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import fg from 'fast-glob';

import type { CoverageOverlayEntry, VerificationCriterion } from '@/core/types/planning.js';

export async function buildCoverageOverlay(
  root: string,
  modules: string[],
): Promise<CoverageOverlayEntry[]> {
  const testFiles = await fg(['tests/**/*.ts', 'src/**/*.test.ts'], {
    cwd: root,
    onlyFiles: true,
  });
  const relevantModules = new Set(modules.filter(Boolean));
  const entries = new Map<string, CoverageOverlayEntry>();

  for (const file of testFiles) {
    if (relevantModules.size > 0 && !matchesModule(file, relevantModules)) {
      continue;
    }

    const raw = await readFile(join(root, file), 'utf8');
    const matches = Array.from(raw.matchAll(/@obligation\s+([A-Z]+-\d+)/g), (match) => match[1]);

    if (matches.length === 0) {
      const fallbackId = file
        .split('/')
        .pop()
        ?.replace(/\.test\.ts$/, '')
        ?.replace(/[^A-Za-z0-9-]+/g, '-')
        ?.toUpperCase();
      if (fallbackId) {
        entries.set(fallbackId, {
          criterion_id: fallbackId,
          status: 'partial',
          evidence_files: [file],
        });
      }
      continue;
    }

    for (const criterionId of matches) {
      const current = entries.get(criterionId);
      entries.set(criterionId, {
        criterion_id: criterionId,
        status: 'covered',
        evidence_files: [...new Set([...(current?.evidence_files ?? []), file])],
      });
    }
  }

  return [...entries.values()].sort((left, right) =>
    left.criterion_id.localeCompare(right.criterion_id),
  );
}

export function markCriteriaFromOverlay(
  criteria: VerificationCriterion[],
  overlay: CoverageOverlayEntry[],
): VerificationCriterion[] {
  return criteria.map((criterion) => {
    const exact = overlay.find((entry) => entry.criterion_id === criterion.criterion_id);
    if (exact) {
      return { ...criterion, status: exact.status };
    }

    const proofTargetName = criterion.proof_target
      ?.split('/')
      .pop()
      ?.replace(/\.[^.]+$/, '');
    const fuzzy = overlay.find((entry) => {
      const entryName = entry.evidence_files[0]
        ?.split('/')
        .pop()
        ?.replace(/\.[^.]+$/, '');
      return (
        (proofTargetName !== undefined && entryName === proofTargetName) ||
        normalizeToken(criterion.criterion_id) === normalizeToken(entry.criterion_id) ||
        /* c8 ignore next */
        normalizeToken(criterion.criterion_id) === normalizeToken(entryName ?? '')
      );
    });

    if (fuzzy) {
      return { ...criterion, status: 'partial' };
    }

    return { ...criterion, status: criterion.status ?? 'uncovered' };
  });
}

function matchesModule(file: string, modules: Set<string>): boolean {
  if (file.startsWith('tests/')) {
    return true;
  }
  return [...modules].some(
    (moduleName) => file.includes(`/${moduleName}/`) || file.startsWith(`${moduleName}/`),
  );
}

function normalizeToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}
