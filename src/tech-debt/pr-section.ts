import { PATHS } from '@/core/constants/paths.js';

export const TECH_DEBT_PR_HEADING = '## Tech debt found in this change';

export interface TechDebtPrItem {
  id: string;
  title: string;
  kind: string;
  severity: string;
}

export function renderTechDebtPrSection(items: readonly TechDebtPrItem[]): string {
  if (items.length === 0) {
    return '';
  }
  const lines = items.map(
    (item) =>
      `- ${item.id} (${item.kind}, ${item.severity}): ${item.title.replace(/\s+/g, ' ').trim()}. ${PATHS.TECH_DEBT_DIR}/${item.id}.md`,
  );
  return [TECH_DEBT_PR_HEADING, '', ...lines].join('\n');
}
