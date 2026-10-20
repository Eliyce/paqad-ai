import type { EvidenceLedgerRow } from '@/core/types/evidence-ledger.js';
import type { FeatureSpec } from '@/core/types/feature-spec.js';
import { readUnitFile, type SessionLedgerRow } from '@/session-ledger/ledger.js';

import { readFeatureEvidence } from './bundle-ledgers.js';
import { rowRecordedAt } from './envelope.js';
import { readFeatureSpecification } from './artifacts.js';
import { listFeatureDirs } from './delivery.js';
import { featureFilePath } from './paths.js';

export function readAllFeatureStageRows(projectRoot: string): SessionLedgerRow[] {
  return listFeatureDirs(projectRoot).flatMap((dirName) =>
    readUnitFile(projectRoot, featureFilePath(dirName, 'stageEvidence')),
  );
}

export function readAllFeatureRuleRuns(projectRoot: string): SessionLedgerRow[] {
  return listFeatureDirs(projectRoot).flatMap((dirName) =>
    readUnitFile(projectRoot, featureFilePath(dirName, 'ruleRun')),
  );
}

export function readAllFeatureDuplication(projectRoot: string): SessionLedgerRow[] {
  return listFeatureDirs(projectRoot).flatMap((dirName) =>
    readUnitFile(projectRoot, featureFilePath(dirName, 'duplication')),
  );
}

export function readAllFeatureChangeMetrics(projectRoot: string): SessionLedgerRow[] {
  return listFeatureDirs(projectRoot).flatMap((dirName) =>
    readUnitFile(projectRoot, featureFilePath(dirName, 'changeMetrics')),
  );
}

export function readAllFeatureRag(projectRoot: string): SessionLedgerRow[] {
  return listFeatureDirs(projectRoot).flatMap((dirName) =>
    readUnitFile(projectRoot, featureFilePath(dirName, 'rag')),
  );
}

export function readFeatureChangeMetricsWindow(
  projectRoot: string,
  limit: number,
): SessionLedgerRow[] {
  const rows = readAllFeatureChangeMetrics(projectRoot)
    .slice()
    .sort((a, b) => (rowRecordedAt(a) ?? '').localeCompare(rowRecordedAt(b) ?? ''));
  return limit >= rows.length ? rows : rows.slice(rows.length - limit);
}

export function readAllFeatureEvidence(projectRoot: string): EvidenceLedgerRow[] {
  return listFeatureDirs(projectRoot).flatMap((dirName) =>
    readFeatureEvidence(projectRoot, dirName),
  );
}

export function readAllFeatureSpecifications(projectRoot: string): FeatureSpec[] {
  return readAllFeatureSpecificationEntries(projectRoot).map((entry) => entry.spec);
}

export interface FeatureSpecificationEntry {
  dirName: string;
  spec: FeatureSpec;
}

export function readAllFeatureSpecificationEntries(
  projectRoot: string,
): FeatureSpecificationEntry[] {
  const entries: FeatureSpecificationEntry[] = [];
  for (const dirName of listFeatureDirs(projectRoot)) {
    const spec = readFeatureSpecification(projectRoot, dirName);
    if (spec && spec.frozen !== null && spec.frozen !== undefined) {
      entries.push({ dirName, spec });
    }
  }
  return entries;
}
