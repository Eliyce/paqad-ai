import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { HOST_SURFACES_PARAGRAPH } from '@/onboarding/narration-contract-writer.js';

import {
  TASK_LIST_SENTENCES,
  laneStages,
} from '../../../runtime/claude-plugin/mod/desktop-view.ts';

const FULL_LANE = [
  'planning',
  'specification',
  'development',
  'review',
  'checks',
  'documentation_sync',
];

function listIn(text: string, pattern: RegExp): string[] {
  const match = pattern.exec(text);
  expect(match).not.toBeNull();
  return match![1]!.split(',').map((word) => word.trim());
}

describe('AC-21: the task list and the band strip name the same steps in the same order', () => {
  const strip = laneStages({ lane: 'full', lane_stages: FULL_LANE }).map(([, label]) => label);

  it('the band keeps its six stages', () => {
    expect(strip).toEqual(['Plan', 'Spec', 'Build', 'Review', 'Checks', 'Docs']);
  });

  it('the router task list has no Load rules item and matches the strip', () => {
    const router = listIn(HOST_SURFACES_PARAGRAPH, /task items in order \(([^)]+)\)/);
    expect(router).not.toContain('Load rules');
    expect(router).toEqual(strip);
    expect(readFileSync(join(process.cwd(), 'runtime/AGENT-ROUTER.md'), 'utf8')).not.toContain(
      'Load rules, Build',
    );
  });

  it('the prompt gate and the HUD refusal name the same list', () => {
    const gate = readFileSync(
      join(process.cwd(), 'runtime/hooks/agent-entry-prompt-gate.mjs'),
      'utf8',
    );
    expect(gate).toContain(TASK_LIST_SENTENCES.full);
    expect(listIn(TASK_LIST_SENTENCES.full, /paqad task list: ([^.]+)\./)).toEqual(strip);
  });
});
