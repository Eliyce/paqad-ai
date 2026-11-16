import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { createRun, emptyStages } from '../../../../../src/onboarding/journey/run-store.js';
import type { JourneyEvent, JourneyRun } from '../../../../../src/onboarding/journey/types.js';

export const T0 = '2026-01-01T10:00:00.000Z';

export function at(minutes: number): string {
  return new Date(new Date(T0).getTime() + minutes * 60_000).toISOString();
}

export function clockAt(minutes: number): () => Date {
  return () => new Date(at(minutes));
}

export function tempRoot(prefix = 'paqad-journey-'): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

export function writeFile(root: string, rel: string, content: string): void {
  const full = join(root, rel);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
}

export function baseRun(overrides: Partial<JourneyRun> = {}): Omit<JourneyRun, 'revision'> {
  return {
    schema_version: 1,
    run_id: 'run-1',
    status: 'running',
    owner_session: 'session-a',
    providers: ['claude-code'],
    allow_list: true,
    asked: 'tray',
    created_at: T0,
    updated_at: T0,
    stages: emptyStages(),
    written: {},
    setup_hashes: {},
    baseline: {},
    ...overrides,
  };
}

export function seedRun(root: string, overrides: Partial<JourneyRun> = {}): JourneyRun {
  return createRun(root, baseRun(overrides));
}

export function unitRow(
  stage: JourneyEvent['stage'],
  unit: string,
  ts: string,
  extra: Partial<JourneyEvent> = {},
): JourneyEvent {
  return { ts, run_id: 'run-1', kind: 'unit', stage, unit, ...extra };
}

export function moduleMap(slugs: Array<string | { slug: string; sources: string[] }>): string {
  const lines = ['version: 2', 'modules:'];
  for (const entry of slugs) {
    const slug = typeof entry === 'string' ? entry : entry.slug;
    const sources = typeof entry === 'string' ? [`src/${entry}`] : entry.sources;
    lines.push(`  - slug: ${slug}`, `    sources: [${sources.join(', ')}]`);
  }
  return `${lines.join('\n')}\n`;
}
