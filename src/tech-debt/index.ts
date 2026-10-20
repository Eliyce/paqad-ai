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

export function refreshTechDebtOverview(projectRoot: string): OverviewBlockResult {
  return reconcileTechDebtOverview(projectRoot, readDebtItems(projectRoot));
}

export function raiseTechDebt(
  projectRoot: string,
  input: AddDebtInput,
  now: Date = new Date(),
): AddDebtResult {
  const result = addDebtItem(projectRoot, input, now);
  if (result.outcome !== 'existing') {
    refreshTechDebtOverview(projectRoot);
  }
  return result;
}

export function promoteTechDebt(projectRoot: string, id: string, issue: string): TechDebtItem {
  const item = promoteDebtItem(projectRoot, id, issue);
  refreshTechDebtOverview(projectRoot);
  return item;
}

export function closeTechDebt(projectRoot: string, id: string, reason: string): TechDebtItem {
  const item = closeDebtItem(projectRoot, id, reason);
  refreshTechDebtOverview(projectRoot);
  return item;
}
