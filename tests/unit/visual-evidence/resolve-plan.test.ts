import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resolveVisualEvidencePlan } from '@/visual-evidence/resolve-plan.js';

let root: string;
const roots: string[] = [];

function siteMapDir(): string {
  return join(root, 'docs', 'site-map');
}
function journeysDir(): string {
  return join(siteMapDir(), 'journeys');
}

function writeAppMap(surfaces: unknown[]): void {
  const map = {
    schema_version: 1,
    app: { name: 'demo', kind: 'web' },
    surfaces,
  };
  writeFileSync(join(siteMapDir(), 'app-map.yaml'), JSON.stringify(map), 'utf8');
}

function writeJourney(id: string, status: string, entry: string, stepSurfaces: string[]): void {
  const doc = {
    schema_version: 1,
    id,
    label: `Journey ${id}`,
    actor: 'developer',
    goal: 'g',
    entry,
    status,
    steps: stepSurfaces.map((surface, i) => ({ surface, action: `Step ${i + 1}` })),
    ends: { success: 'done' },
  };
  writeFileSync(join(journeysDir(), `${id}.journey.yaml`), JSON.stringify(doc), 'utf8');
}

function writeCapture(id: string, journey: string, steps: number[]): void {
  writeFileSync(
    join(journeysDir(), `${id}.capture.yaml`),
    JSON.stringify({
      schema_version: 1,
      journey,
      steps: steps.map((n) => ({ journey_step: n })),
    }),
    'utf8',
  );
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'paqad-veplan-'));
  roots.push(root);
  mkdirSync(journeysDir(), { recursive: true });
});
afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

describe('resolveVisualEvidencePlan', () => {
  it('resolves a confirmed journey via an evidence anchor and records matched_by', () => {
    writeAppMap([
      { id: 'goals', kind: 'page', label: 'Goals', module: 'goals', evidence: { file: 'src/pages/Goals.tsx' } },
    ]);
    writeJourney('checkout', 'confirmed', 'goals', ['goals']);
    writeCapture('checkout', 'checkout', [1]);

    const plan = resolveVisualEvidencePlan(root, ['src/pages/Goals.tsx']);
    expect(plan.skips).toEqual([]);
    expect(plan.entries).toHaveLength(1);
    expect(plan.entries[0]!.journey_id).toBe('checkout');
    expect(plan.entries[0]!.matched_by).toEqual([
      { file: 'src/pages/Goals.tsx', surface: 'goals', module: 'goals' },
    ]);
  });

  it('matches a changed file inside an anchored subtree', () => {
    writeAppMap([{ id: 'goals', kind: 'page', label: 'Goals', evidence: { file: 'src/pages/goals' } }]);
    writeJourney('checkout', 'confirmed', 'goals', ['goals']);
    writeCapture('checkout', 'checkout', [1]);
    const plan = resolveVisualEvidencePlan(root, ['src/pages/goals/Chart.tsx']);
    expect(plan.entries).toHaveLength(1);
  });

  it('records no-documented-flow when nothing matches', () => {
    writeAppMap([{ id: 'goals', kind: 'page', label: 'Goals', evidence: { file: 'src/pages/Goals.tsx' } }]);
    writeJourney('checkout', 'confirmed', 'goals', ['goals']);
    writeCapture('checkout', 'checkout', [1]);
    const plan = resolveVisualEvidencePlan(root, ['src/pages/Unrelated.tsx']);
    expect(plan.entries).toEqual([]);
    expect(plan.skips).toEqual([
      { reason: 'no-documented-flow', detail: expect.stringContaining('no confirmed journey') },
    ]);
  });

  it('records no-capture-script for a matched journey with no script', () => {
    writeAppMap([{ id: 'goals', kind: 'page', label: 'Goals', evidence: { file: 'src/pages/Goals.tsx' } }]);
    writeJourney('review-flow', 'confirmed', 'goals', ['goals']);
    // no review-flow.capture.yaml
    const plan = resolveVisualEvidencePlan(root, ['src/pages/Goals.tsx']);
    expect(plan.entries).toEqual([]);
    expect(plan.skips.some((s) => s.reason === 'no-capture-script')).toBe(true);
  });

  it('ignores proposed journeys and records capture-script-invalid for a proposed reference', () => {
    writeAppMap([{ id: 'goals', kind: 'page', label: 'Goals', evidence: { file: 'src/pages/Goals.tsx' } }]);
    writeJourney('draft', 'proposed', 'goals', ['goals']);
    writeCapture('draft', 'draft', [1]);
    const plan = resolveVisualEvidencePlan(root, ['src/pages/Goals.tsx']);
    expect(plan.entries).toEqual([]);
    // the proposed journey is not confirmed -> no-documented-flow, and its capture script is invalid
    expect(plan.skips.some((s) => s.reason === 'capture-script-invalid')).toBe(true);
    expect(plan.skips.some((s) => s.reason === 'no-documented-flow')).toBe(true);
  });

  it('orders entries by journey id ascending', () => {
    writeAppMap([{ id: 'goals', kind: 'page', label: 'Goals', evidence: { file: 'src/pages/Goals.tsx' } }]);
    writeJourney('bravo', 'confirmed', 'goals', ['goals']);
    writeJourney('alpha', 'confirmed', 'goals', ['goals']);
    writeCapture('bravo', 'bravo', [1]);
    writeCapture('alpha', 'alpha', [1]);
    const plan = resolveVisualEvidencePlan(root, ['src/pages/Goals.tsx']);
    expect(plan.entries.map((e) => e.journey_id)).toEqual(['alpha', 'bravo']);
  });

  it('tolerates a missing site map (no surfaces) as no-documented-flow', () => {
    const plan = resolveVisualEvidencePlan(root, ['src/pages/Goals.tsx']);
    expect(plan.entries).toEqual([]);
    expect(plan.skips.some((s) => s.reason === 'no-documented-flow')).toBe(true);
  });
});
