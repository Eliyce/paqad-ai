import { writeFeatureTechDebtIndex } from '@/feature-evidence/tech-debt-index.js';

import {
  addDebtItem,
  closeDebtItem,
  promoteDebtItem,
  readDebtItems,
  type AddDebtInput,
  type AddDebtResult,
  type TechDebtItem,
} from './items.js';
import { reconcileTechDebtOverview, type OverviewBlockResult } from './overview-block.js';

export * from './items.js';
export * from './overview-block.js';
export * from './pr-section.js';

export interface ActiveBundle {
  dirName: string | null;
  sessionId?: string | null;
}

export function refreshTechDebtOverview(projectRoot: string): OverviewBlockResult {
  return reconcileTechDebtOverview(projectRoot, readDebtItems(projectRoot));
}

function refreshAll(projectRoot: string, bundle: ActiveBundle | undefined): void {
  refreshTechDebtOverview(projectRoot);
  if (bundle?.dirName) {
    writeFeatureTechDebtIndex(projectRoot, bundle.dirName, { sessionId: bundle.sessionId });
  }
}

export function raiseTechDebt(
  projectRoot: string,
  input: AddDebtInput,
  now: Date = new Date(),
  bundle?: ActiveBundle,
): AddDebtResult {
  const result = addDebtItem(projectRoot, input, now);
  if (result.outcome !== 'existing') {
    refreshAll(projectRoot, bundle);
  }
  return result;
}

export function promoteTechDebt(
  projectRoot: string,
  id: string,
  issue: string,
  bundle?: ActiveBundle,
): TechDebtItem {
  const item = promoteDebtItem(projectRoot, id, issue);
  refreshAll(projectRoot, bundle);
  return item;
}

export function closeTechDebt(
  projectRoot: string,
  id: string,
  reason: string,
  bundle?: ActiveBundle,
): TechDebtItem {
  const item = closeDebtItem(projectRoot, id, reason);
  refreshAll(projectRoot, bundle);
  return item;
}
