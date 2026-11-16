import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';

import { readJsonLines } from './io.js';
import type { JourneyEvent } from './types.js';

export function eventsPath(projectRoot: string): string {
  return join(projectRoot, PATHS.ONBOARDING_EVENTS);
}

export function appendEvent(projectRoot: string, event: JourneyEvent): void {
  const path = eventsPath(projectRoot);
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(event)}\n`, { encoding: 'utf8', flag: 'a' });
}

export function readEvents(projectRoot: string, runId?: string): JourneyEvent[] {
  return readJsonLines<JourneyEvent>(
    eventsPath(projectRoot),
    (row) =>
      typeof row.ts === 'string' &&
      typeof row.kind === 'string' &&
      (runId === undefined || row.run_id === runId),
  );
}
