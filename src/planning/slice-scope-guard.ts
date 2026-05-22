import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, extname, join } from 'node:path';

import type {
  ExecutionSlice,
  SliceScopeCheck,
  SliceScopeViolation,
} from '@/core/types/planning.js';
import type { DecisionCategory } from './decision-packet.js';
import { detectDecisionForks } from './decision-detector.js';

const PROTECTED_PREFIXES = ['.paqad/', 'node_modules/'];

export interface UndeclaredDecisionFinding {
  category: DecisionCategory;
  file: string;
  matched_existing?: string;
  reason: string;
}

export function snapshotSliceScope(
  projectRoot: string,
  files: string[],
): Record<string, string | null> {
  return Object.fromEntries(
    [...new Set(files)].map((file) => [file, hashFile(join(projectRoot, file))]),
  );
}

export function verifySliceScope(input: {
  slice: ExecutionSlice;
  allSlices: ExecutionSlice[];
  modifiedFiles: string[];
  priorWarnings?: string[];
}): SliceScopeCheck {
  const modified = [...new Set(input.modifiedFiles)].sort();
  const manifestFiles = new Set(input.allSlices.flatMap((slice) => slice.touches));
  const currentFiles = new Set(input.slice.touches);
  const priorSliceIds = collectRelatedSliceIds(input.allSlices, input.slice.slice_id, 'prior');
  const futureSliceIds = collectRelatedSliceIds(input.allSlices, input.slice.slice_id, 'future');
  const priorFiles = new Set(
    input.allSlices
      .filter((slice) => priorSliceIds.has(slice.slice_id))
      .flatMap((slice) => slice.touches),
  );
  const futureFiles = new Set(
    input.allSlices
      .filter((slice) => futureSliceIds.has(slice.slice_id))
      .flatMap((slice) => slice.touches),
  );
  const violations: SliceScopeViolation[] = [];
  const priorWarnings = new Set(input.priorWarnings ?? []);

  for (const file of modified) {
    if (currentFiles.has(file)) {
      continue;
    }
    if (PROTECTED_PREFIXES.some((prefix) => file.startsWith(prefix))) {
      violations.push({ file, type: 'protected-file', severity: 'error' });
      continue;
    }
    if (!manifestFiles.has(file)) {
      violations.push({ file, type: 'outside-manifest', severity: 'error' });
      continue;
    }
    if (futureFiles.has(file)) {
      violations.push({ file, type: 'future-slice', severity: 'warning' });
      continue;
    }
    if (priorFiles.has(file)) {
      violations.push({
        file,
        type: 'prior-slice',
        severity: priorWarnings.has(file) ? 'error' : 'warning',
      });
    }
  }

  return {
    status:
      violations.length === 0
        ? 'clean'
        : violations.some((violation) => violation.severity === 'error')
          ? 'violation'
          : 'warning',
    modified_files: modified,
    violations,
  };
}

export function diffSnapshotFiles(
  projectRoot: string,
  baseline: Record<string, string | null>,
): string[] {
  return Object.entries(baseline)
    .filter(([file, hash]) => hashFile(join(projectRoot, file)) !== hash)
    .map(([file]) => file)
    .sort();
}

export function detectUndeclaredDecisionSignals(input: {
  projectRoot: string;
  slice: ExecutionSlice;
  modifiedFiles: string[];
}): UndeclaredDecisionFinding[] {
  const forks = detectDecisionForks(input.slice.goal);
  const findings: UndeclaredDecisionFinding[] = [];
  for (const fork of forks) {
    if (fork.category === 'component-reuse' || fork.category === 'create-vs-reuse') {
      for (const file of input.modifiedFiles) {
        const matchedExisting = findReuseSibling(input.projectRoot, file);
        if (!matchedExisting) {
          continue;
        }
        findings.push({
          category: fork.category,
          file,
          matched_existing: matchedExisting,
          reason: `undeclared_decision: created ${file} while ${matchedExisting} already existed as a reuse candidate`,
        });
      }
    }
    if (fork.category === 'architecture-path' && input.modifiedFiles.length > 1) {
      findings.push({
        category: fork.category,
        /* v8 ignore next 1 -- length > 1 guarantees index 0 exists */
        file: input.modifiedFiles[0] ?? 'unknown',
        reason: `undeclared_decision: multiple implementation paths were touched (${input.modifiedFiles.join(', ')}) without a declared decision`,
      });
    }
  }

  if (findings.length === 0) {
    for (const file of input.modifiedFiles) {
      const matchedExisting = findReuseSibling(input.projectRoot, file);
      if (!matchedExisting) {
        continue;
      }
      findings.push({
        category: 'create-vs-reuse',
        file,
        matched_existing: matchedExisting,
        reason: `undeclared_decision: created ${file} while ${matchedExisting} already existed as a reuse candidate`,
      });
    }
  }

  return dedupeFindings(findings);
}

function collectRelatedSliceIds(
  slices: ExecutionSlice[],
  currentSliceId: string,
  direction: 'prior' | 'future',
): Set<string> {
  const currentIndex = slices.findIndex((slice) => slice.slice_id === currentSliceId);
  if (currentIndex === -1) {
    return new Set();
  }

  const related =
    direction === 'prior' ? slices.slice(0, currentIndex) : slices.slice(currentIndex + 1);
  return new Set(related.map((slice) => slice.slice_id));
}

function hashFile(path: string): string | null {
  if (!existsSync(path)) {
    return null;
  }

  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function findReuseSibling(projectRoot: string, file: string): string | null {
  const slashIndex = file.lastIndexOf('/');
  if (slashIndex === -1) {
    return null;
  }
  const directory = file.slice(0, slashIndex);
  const absoluteDirectory = join(projectRoot, directory);
  if (!existsSync(absoluteDirectory)) {
    return null;
  }

  const extension = extname(file);
  const targetStem = normalizeStem(basename(file, extension));
  if (!targetStem) {
    return null;
  }

  for (const sibling of safeListFiles(absoluteDirectory)) {
    const siblingRelative = `${directory}/${sibling}`;
    if (siblingRelative === file || extname(sibling) !== extension) {
      continue;
    }
    if (normalizeStem(basename(sibling, extension)) === targetStem) {
      return siblingRelative;
    }
  }
  return null;
}

function normalizeStem(stem: string): string {
  return stem
    .toLowerCase()
    .replace(/(^new[-_]?|[-_]?copy$|[-_]?alt$|[-_]?variant$|[-_]?v\d+$)/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function safeListFiles(directory: string): string[] {
  try {
    return readdirSync(directory);
  } catch {
    return [];
  }
}

function dedupeFindings(findings: UndeclaredDecisionFinding[]): UndeclaredDecisionFinding[] {
  const seen = new Set<string>();
  return findings.filter((finding) => {
    const key = `${finding.category}:${finding.file}:${finding.matched_existing ?? ''}:${finding.reason}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}
