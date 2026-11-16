import { rmSync } from 'node:fs';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  checkEndGate,
  checkStartGate,
  proveStage,
  type ProofContext,
} from '@/onboarding/journey/proof.js';
import { emptyStages } from '@/onboarding/journey/run-store.js';
import type { JourneyRun } from '@/onboarding/journey/types.js';

import { at, baseRun, tempRoot, writeFile } from './fixtures/journey.js';

let root: string;

beforeEach(() => {
  root = tempRoot('paqad-proof-edges-');
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function ctx(overrides: Partial<JourneyRun> = {}): ProofContext {
  return { projectRoot: root, run: { ...baseRun(overrides), revision: 1 }, events: [] };
}

function failed(context: ProofContext, stage: Parameters<typeof proveStage>[1]): string[] {
  return proveStage(context, stage)
    .filter((proof) => !proof.ok)
    .map((proof) => proof.item);
}

describe('FR-11 FR-20: proofs fail closed when nothing was recorded', () => {
  it('step 1 has no proof without a detection, a reason or a known stack', () => {
    expect(failed(ctx(), 'detect')).toEqual(['detection']);
    const stages = emptyStages();
    stages.detect = { status: 'running', started_at: at(1) };
    const detection = {
      stack: 'react',
      capabilities: [],
      source: 'ai' as const,
      reason: '  ',
      detected_at: at(2),
    };
    expect(failed(ctx({ stages, detection }), 'detect')).toEqual(['detection']);
    expect(
      failed(ctx({ stages, detection: { ...detection, stack: 'cobol', reason: 'x' } }), 'detect'),
    ).toEqual(['detection']);
    expect(failed(ctx({ stages, detection: { ...detection, reason: 'vite' } }), 'detect')).toEqual(
      [],
    );
  });

  it('step 2 has no proof without a setup record', () => {
    expect(failed(ctx(), 'setup')).toEqual(
      expect.arrayContaining(['setup_result', 'no_step_failures', 'framework_path']),
    );
  });

  it('step 5 has no proof without a finished discovery run from this step', () => {
    expect(failed(ctx(), 'rules_discovery')).toEqual(expect.arrayContaining(['discovery_run']));
  });

  it('step 4 needs a module map to prove anything about modules', () => {
    expect(proveStage(ctx(), 'module_docs').some((proof) => proof.item.startsWith('module:'))).toBe(
      false,
    );
  });

  it('step 8 has no proof without a report, and a report with no date is not fresh', () => {
    expect(failed(ctx(), 'finish')).toEqual(expect.arrayContaining(['report', 'rag_ready']));
    writeFile(root, '.paqad/onboarding/report.json', '{"rag":"off"}');
    writeFile(root, '.paqad/onboarding/report.md', '# report');
    expect(failed(ctx(), 'finish')).toEqual(expect.arrayContaining(['report', 'rag_ready']));
  });
});

describe('FR-25: gates', () => {
  it('a degraded step with no recorded gap codes lets the next step start', () => {
    const stages = emptyStages();
    stages.detect = { status: 'degraded' };
    expect(checkStartGate({ ...baseRun({ stages }), revision: 1 }, 'setup')).toMatchObject({
      ok: true,
    });
  });

  it('the end gate refuses a gap code that is not one, or not allowed for the step', () => {
    const stages = emptyStages();
    stages.detect = { status: 'running', started_at: at(1) };
    const context = ctx({ stages });
    expect(checkEndGate(context, 'detect', ['skipped'])).toMatchObject({
      ok: false,
      message: expect.stringContaining('"skipped" is not a gap code'),
    });
    expect(checkEndGate(context, 'detect', ['rag_off'])).toMatchObject({
      ok: false,
      message: expect.stringContaining('"rag_off" is not an allowed gap for step 1'),
    });
  });
});
