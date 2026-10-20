import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { readTextIfExistsSync } from '@/core/fs/read-if-exists.js';
import { replaceMarkerBlock } from '@/core/text/marker-block.js';

import { newestFirst, techDebtDir, type TechDebtItem } from './items.js';

export const TECH_DEBT_BLOCK_BEGIN = '<!-- paqad:tech-debt:start -->';
export const TECH_DEBT_BLOCK_END = '<!-- paqad:tech-debt:end -->';

const OVERVIEW_NAMES = ['overview.md', 'index.md'] as const;

export interface OverviewBlockResult {
  path: string;
  written: boolean;
}

export function techDebtOverviewPath(projectRoot: string): string {
  const dir = techDebtDir(projectRoot);
  const found = OVERVIEW_NAMES.map((name) => join(dir, name)).find((path) => existsSync(path));
  return found ?? join(dir, OVERVIEW_NAMES[0]);
}

export function escapeInline(value: string): string {
  return value
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function renderDebtLine(item: TechDebtItem): string {
  return `- [${item.id}](${item.id}.md) (${item.kind}, ${item.severity}): ${escapeInline(item.title)}`;
}

export function renderTechDebtBlock(items: TechDebtItem[], eol = '\n'): string {
  const lines = items
    .filter((item) => item.status === 'open')
    .sort(newestFirst)
    .map(renderDebtLine);
  return [TECH_DEBT_BLOCK_BEGIN, ...lines, TECH_DEBT_BLOCK_END].join(eol);
}

export function upsertTechDebtBlock(existing: string, items: TechDebtItem[]): string {
  const eol = existing.includes('\r\n') ? '\r\n' : '\n';
  const block = renderTechDebtBlock(items, eol);
  const replaced = replaceMarkerBlock(existing, TECH_DEBT_BLOCK_BEGIN, TECH_DEBT_BLOCK_END, block);
  if (replaced !== null) {
    return replaced;
  }
  if (existing.length === 0) {
    return `${block}${eol}`;
  }
  const separator = existing.endsWith('\n') ? eol : `${eol}${eol}`;
  return `${existing}${separator}${block}${eol}`;
}

export function reconcileTechDebtOverview(
  projectRoot: string,
  items: TechDebtItem[],
): OverviewBlockResult {
  const path = techDebtOverviewPath(projectRoot);
  const existing = readTextIfExistsSync(path) ?? '';
  const next = upsertTechDebtBlock(existing, items);
  if (next === existing) {
    return { path, written: false };
  }
  mkdirSync(techDebtDir(projectRoot), { recursive: true });
  writeFileSync(path, next);
  return { path, written: true };
}
