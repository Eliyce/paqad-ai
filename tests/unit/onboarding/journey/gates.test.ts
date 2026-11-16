import { describe, expect, it } from 'vitest';

import { parseDegradedCodes } from '../../../../src/onboarding/journey/degraded.js';
import { checkEndGate, checkStartGate } from '../../../../src/onboarding/journey/proof.js';
import { emptyStages } from '../../../../src/onboarding/journey/run-store.js';
import type { JourneyRun } from '../../../../src/onboarding/journey/types.js';

import { at, baseRun } from './fixtures/journey.js';

function runWith(stages: Partial<JourneyRun['stages']>): JourneyRun {
  return { ...baseRun({ stages: { ...emptyStages(), ...stages } }), revision: 4 };
}

describe('onboarding stage gates', () => {
  it('AC-5: step 4 cannot start while step 3 is not done, and the message names step 3', () => {
    const run = runWith({
      detect: { status: 'done' },
      setup: { status: 'done' },
      project_docs: { status: 'running' },
    });
    const gate = checkStartGate(run, 'module_docs');
    expect(gate.ok).toBe(false);
    if (gate.ok) return;
    expect(gate.blocking).toBe('project_docs');
    expect(gate.message).toContain('step 3 (Write the project docs)');
  });

  it('AC-5: an allowed gap lets the next step start', () => {
    const run = runWith({
      detect: { status: 'done' },
      setup: { status: 'degraded', degraded: ['git_workflow_kept'] },
    });
    expect(checkStartGate(run, 'project_docs').ok).toBe(true);
  });

  it('AC-5: a gap not on the step allowed list blocks the next step', () => {
    const run = runWith({
      detect: { status: 'done' },
      setup: { status: 'degraded', degraded: ['research_offline'] },
    });
    const gate = checkStartGate(run, 'project_docs');
    expect(gate.ok).toBe(false);
    if (!gate.ok) expect(gate.message).toContain('gap that blocks');
  });

  it('AC-5: no flag accepts a skip state or free-text gap', () => {
    expect(parseDegradedCodes('module_docs', ['skip']).ok).toBe(false);
    expect(parseDegradedCodes('module_docs', ['skipped']).ok).toBe(false);
    expect(parseDegradedCodes('setup', ['network was slow']).ok).toBe(false);
    expect(parseDegradedCodes('setup', ['rag_off']).ok).toBe(false);
    expect(parseDegradedCodes('finish', ['rag_off'])).toEqual({ ok: true, codes: ['rag_off'] });
  });

  it('AC-6: ending a step that is not running is refused', () => {
    const run = runWith({ detect: { status: 'done', started_at: at(1) } });
    const gate = checkEndGate({ projectRoot: '/nonexistent', run, events: [] }, 'detect', []);
    expect(gate.ok).toBe(false);
  });

  it('a failed earlier step blocks every later step', () => {
    const run = runWith({ detect: { status: 'failed', failure: 'boom' } });
    for (const later of ['setup', 'finish'] as const) {
      expect(checkStartGate(run, later).ok).toBe(false);
    }
    expect(checkStartGate(run, 'detect').ok).toBe(true);
  });
});
