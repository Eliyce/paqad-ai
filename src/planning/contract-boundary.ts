import { readFile } from 'node:fs/promises';
import { basename, extname, join, relative } from 'node:path';

import fg from 'fast-glob';

import type { PlanningManifest, VerificationCriterion } from '@/core/types/planning.js';

export interface ContractBoundary {
  file: string;
  symbol: string;
  importers: string[];
}

export async function detectContractBoundaries(
  root: string,
  touchedFiles: string[],
): Promise<ContractBoundary[]> {
  const tsFiles = await fg('src/**/*.ts', { cwd: root, onlyFiles: true });
  const untouchedFiles = tsFiles.filter((file) => !touchedFiles.includes(file));
  const boundaries: ContractBoundary[] = [];

  for (const touchedFile of touchedFiles.filter((file) => file.endsWith('.ts'))) {
    const raw = await readFile(join(root, touchedFile), 'utf8').catch(() => '');
    const exportedSymbols = Array.from(
      raw.matchAll(
        /export\s+(?:async\s+)?(?:function|const|class|type|interface)\s+([A-Za-z_]\w*)/g,
      ),
      (match) => match[1],
    );
    if (exportedSymbols.length === 0) {
      continue;
    }

    const stem = basename(touchedFile, extname(touchedFile));
    const importers: string[] = [];
    for (const candidate of untouchedFiles) {
      const source = await readFile(join(root, candidate), 'utf8').catch(() => '');
      /* c8 ignore next */
      if (
        source.includes(stem) ||
        source.includes(
          relative(join(root, candidate, '..'), join(root, touchedFile)).replace(/\\/g, '/'),
        )
      ) {
        importers.push(candidate);
      }
    }

    for (const symbol of exportedSymbols) {
      if (importers.length > 0) {
        boundaries.push({ file: touchedFile, symbol, importers });
      }
    }
  }

  return boundaries;
}

export function injectContractBoundaryCriteria(
  manifest: PlanningManifest,
  boundaries: ContractBoundary[],
): PlanningManifest {
  if (boundaries.length === 0) {
    return manifest;
  }

  let nextId = nextCriterionId(manifest.verification_matrix);
  const injected: VerificationCriterion[] = boundaries.map((boundary) => ({
    criterion_id: `AC-${nextId++}`,
    given: `${boundary.symbol} is imported outside the current execution scope.`,
    when: `${boundary.file} changes.`,
    then: `Existing importers remain compatible: ${boundary.importers.join(', ')}`,
    proof_type: 'manual',
    status: 'uncovered',
    source: 'contract-boundary',
    linked_requirement_ids: manifest.requirement_graph
      .filter((requirement) => requirement.scope.includes(boundary.file))
      .map((requirement) => requirement.id),
  }));

  return {
    ...manifest,
    verification_matrix: [...manifest.verification_matrix, ...injected],
  };
}

function nextCriterionId(criteria: VerificationCriterion[]): number {
  return (
    criteria.reduce((max, criterion) => {
      const match = criterion.criterion_id.match(/^AC-(\d+)$/);
      /* c8 ignore next */
      return Math.max(max, match ? Number(match[1]) : 0);
    }, 0) + 1
  );
}
