import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';
import { writeFileAtomic } from '@/hud/files.js';

import { readJsonLines } from './io.js';
import { withJourneyLock } from './run-store.js';
import type { ChoiceRow } from './types.js';

export const AUTO_RESPONDER = 'paqad-onboarding';

export function choicesPath(projectRoot: string): string {
  return join(projectRoot, PATHS.ONBOARDING_CHOICES);
}

export function readChoices(projectRoot: string): ChoiceRow[] {
  return readJsonLines<ChoiceRow>(choicesPath(projectRoot), (row) => typeof row.id === 'string');
}

export function appendChoice(projectRoot: string, row: Omit<ChoiceRow, 'id'>): ChoiceRow {
  return withJourneyLock(projectRoot, () => {
    const id = `C-${readChoices(projectRoot).length + 1}`;
    const full: ChoiceRow = { id, ...row };
    const path = choicesPath(projectRoot);
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, `${JSON.stringify(full)}\n`, { encoding: 'utf8', flag: 'a' });
    return full;
  });
}

export function markChoicesReviewed(
  projectRoot: string,
  ids: readonly string[] | 'all',
  now: () => Date = () => new Date(),
): ChoiceRow[] {
  return withJourneyLock(projectRoot, () => {
    const rows = readChoices(projectRoot);
    const marked: ChoiceRow[] = [];
    const next = rows.map((row) => {
      if (row.reviewed || (ids !== 'all' && !ids.includes(row.id))) return row;
      const reviewed = { ...row, reviewed: true, reviewed_at: now().toISOString() };
      marked.push(reviewed);
      return reviewed;
    });
    const body = next.map((row) => JSON.stringify(row)).join('\n');
    writeFileAtomic(choicesPath(projectRoot), next.length > 0 ? `${body}\n` : '');
    return marked;
  });
}

export function unreviewedAutoDecisionIds(projectRoot: string): Set<string> {
  const ids = new Set<string>();
  for (const row of readChoices(projectRoot)) {
    if (row.by === AUTO_RESPONDER && row.decision_id && !row.reviewed) ids.add(row.decision_id);
  }
  return ids;
}

export function reviewedAutoDecisionIds(projectRoot: string): Set<string> {
  const ids = new Set<string>();
  for (const row of readChoices(projectRoot)) {
    if (row.by === AUTO_RESPONDER && row.decision_id && row.reviewed) ids.add(row.decision_id);
  }
  return ids;
}
