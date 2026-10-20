import { readDebtItems } from '@/tech-debt/items.js';

import { readFeatureIndexEntries, writeFeatureIndexDocument } from './bundle-document.js';
import { featureChangeKey } from './paths.js';
import { FEATURE_DOC_SCHEMA_VERSION, TECH_DEBT_DOC_TYPE } from './types.js';

export interface TechDebtIndexEntry {
  id: string;
  title: string;
  kind: string;
  severity: string;
}

export function collectFeatureTechDebt(projectRoot: string, dirName: string): TechDebtIndexEntry[] {
  const changeKey = featureChangeKey(dirName);
  return readDebtItems(projectRoot)
    .filter((item) => item.found_in.change === changeKey)
    .map((item) => ({ id: item.id, title: item.title, kind: item.kind, severity: item.severity }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

export function readFeatureTechDebtIndex(
  projectRoot: string,
  dirName: string,
): TechDebtIndexEntry[] | null {
  return readFeatureIndexEntries<TechDebtIndexEntry>(projectRoot, dirName, 'techDebt', 'items');
}

export function writeFeatureTechDebtIndex(
  projectRoot: string,
  dirName: string,
  options: { sessionId?: string | null; now?: () => Date } = {},
): { path: string | null; items: TechDebtIndexEntry[]; written: boolean } {
  const items = collectFeatureTechDebt(projectRoot, dirName);
  const { path, written } = writeFeatureIndexDocument({
    projectRoot,
    dirName,
    file: 'techDebt',
    key: 'items',
    docType: TECH_DEBT_DOC_TYPE,
    schemaVersion: FEATURE_DOC_SCHEMA_VERSION,
    entries: items,
    sessionId: options.sessionId,
    now: options.now,
  });
  return { path, items, written };
}
