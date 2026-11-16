import { rmSync } from 'node:fs';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const gate = vi.hoisted(() => ({ pass: false }));

vi.mock('@/onboarding/journey/proof.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/onboarding/journey/proof.js')>();
  return {
    ...original,
    checkEndGate: (...args: Parameters<typeof original.checkEndGate>) =>
      gate.pass ? { ok: true, degraded: [] } : original.checkEndGate(...args),
  };
});

import {
  abandonRun,
  endStage,
  failStage,
  recordProgress,
  recordUnit,
  resumeRun,
  startRun,
  startStage,
  validateProviders,
} from '@/onboarding/journey/actions.js';
import { readChoices } from '@/onboarding/journey/choices.js';
import { readEvents } from '@/onboarding/journey/events.js';
import { MODULE_MAP_PATH, readModuleUnits } from '@/onboarding/journey/modules.js';
import { readRun, updateRun } from '@/onboarding/journey/run-store.js';
import { ONBOARDING_STAGES } from '@/onboarding/journey/stages.js';
import type { StageId } from '@/onboarding/journey/types.js';
import { serializeRuleScriptMap } from '@/rule-scripts/map.js';

import { at, clockAt, moduleMap, seedRun, tempRoot, writeFile } from './fixtures/journey.js';

let root: string;

beforeEach(() => {
  root = tempRoot('paqad-actions-');
  gate.pass = false;
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function doneBefore(stage: StageId, status: 'running' | 'not_started' = 'running'): void {
  updateRun(root, (draft) => {
    for (const before of ONBOARDING_STAGES) {
      if (before.id === stage) break;
      draft.stages[before.id] = { status: 'done' };
    }
    draft.stages[stage] = status === 'running' ? { status, started_at: at(1) } : { status };
  });
}

describe('opening the journey (FR-2, FR-7)', () => {
  it('refuses no AI tool and an unknown one, and drops duplicates', () => {
    expect(() => validateProviders([])).toThrow('Tick at least one AI tool.');
    expect(() => validateProviders(['claude-code', 'emacs'])).toThrow('Unknown AI tools: emacs.');
    expect(validateProviders(['claude-code', 'claude-code'])).toEqual(['claude-code']);
  });

  it('records an agent-attested answer as such and an empty docs baseline by default', () => {
    const run = startRun(
      root,
      {
        providers: ['claude-code'],
        session: 's-1',
        allowList: false,
        asked: 'agent-attested',
        baseline: {},
      },
      clockAt(0),
    );
    expect(run.docs_baseline).toEqual({});
    expect(readChoices(root)).toMatchObject([
      {
        kind: 'providers',
        by: 'agent-attested',
        reason: 'the agent says the person answered the opening question',
      },
    ]);
  });
});

describe('stage verbs refuse out-of-order and malformed calls (AC-2)', () => {
  beforeEach(() => {
    seedRun(root, { owner_session: 'owner' });
  });

  it('refuses a step that already started, and a journey that is paused or finished', () => {
    doneBefore('setup');
    expect(() => startStage(root, 'setup', {}, clockAt(2))).toThrow(
      'Step 2 (Set up paqad) is already running. Use `onboarding resume` to continue it.',
    );
    updateRun(root, (draft) => void (draft.status = 'paused'));
    expect(() => startStage(root, 'setup', {}, clockAt(2))).toThrow(
      'The journey is paused. Run `paqad-ai onboarding resume` first.',
    );
    updateRun(root, (draft) => void (draft.status = 'done'));
    expect(() => recordProgress(root, 'setup', 1, 2, clockAt(2))).toThrow(
      'This onboarding journey is finished.',
    );
  });

  it('starts module docs with no plan when there is no module map, and with the planned count', () => {
    doneBefore('module_docs', 'not_started');
    const run = startStage(root, 'module_docs', { planned: 4 }, clockAt(2));
    expect(run.stages.module_docs.plan).toBeUndefined();
    expect(run.stages.module_docs.planned).toBe(4);
  });

  it('refuses to fail a step that is not running or without a reason, and records a trimmed reason', () => {
    expect(() => failStage(root, 'detect', 'x', clockAt(2))).toThrow(
      'Step 1 (Read your project) is not running.',
    );
    doneBefore('detect');
    expect(() => failStage(root, 'detect', '  ', clockAt(2))).toThrow(
      'Say why the step failed (--reason).',
    );
    const run = failStage(root, 'detect', ' no network ', clockAt(2));
    expect(run.status).toBe('failed');
    expect(run.stages.detect.failure).toBe('no network');
  });

  it('refuses an empty unit, --kept outside module docs, a missing output and bad progress', () => {
    doneBefore('project_docs');
    const unit = (name: string, input: Partial<Parameters<typeof recordUnit>[3]> = {}) =>
      recordUnit(root, 'project_docs', name, { outputs: [], kept: false, ...input }, clockAt(2));
    expect(() => unit(' ')).toThrow('Name the unit that finished.');
    expect(() => unit('stack', { kept: true })).toThrow(
      '--kept is only for a module listed in module-map.yml.',
    );
    expect(() => unit('stack', { outputs: ['docs/stack/none.md'] })).toThrow(
      'The output docs/stack/none.md does not exist.',
    );
    for (const [done, total] of [
      [1.5, 2],
      [1, 2.5],
      [-1, 2],
      [3, 2],
    ] as const) {
      expect(() => recordProgress(root, 'project_docs', done, total, clockAt(2))).toThrow(
        'Progress needs whole numbers with done no larger than total.',
      );
    }
  });

  it('FR-26: keeps an unchanged module and refuses to keep one whose sources changed', () => {
    writeFile(root, MODULE_MAP_PATH, moduleMap(['billing']));
    doneBefore('module_docs');
    expect(() =>
      recordUnit(
        root,
        'module_docs',
        'billing',
        { outputs: [], kept: true, sourceHash: 'stale' },
        clockAt(2),
      ),
    ).toThrow('Module "billing" changed since its docs were written');
    expect(() =>
      recordUnit(root, 'module_docs', 'ghost', { outputs: [], kept: true }, clockAt(2)),
    ).toThrow('--kept is only for a module listed in module-map.yml.');
    const sourceHash = readModuleUnits(root)![0]!.source_hash;
    recordUnit(root, 'module_docs', 'billing', { outputs: [], kept: true, sourceHash }, clockAt(3));
    expect(readEvents(root).at(-1)).toMatchObject({
      kind: 'unit_kept',
      unit: 'billing',
      source_hash: sourceHash,
    });
  });
});

describe('ending step 7 marks journey-added checks warn-only (AC-10)', () => {
  it('records the warn-only choice and the flagged rules when the journey added a checked rule', () => {
    seedRun(root, { rules_before: ['RL-old'] });
    doneBefore('rule_scripts');
    const rule = (id: string) => ({
      id,
      source: 'docs/instructions/rules/coding/q.md',
      text: id,
      text_hash: 'h',
      verifiability: { kind: 'deterministic' },
      enforced_by: [],
      scripts: [
        {
          path: `.paqad/scripts/rules/coding/${id}.mjs`,
          kind: 'deterministic',
          runtime: 'node',
          scope: 'changed-files',
          last_validated_at: at(0),
          fixtures_passed: true,
        },
      ],
    });
    writeFile(
      root,
      'docs/instructions/rules/rule-script-map.yml',
      serializeRuleScriptMap({
        schema_version: 1,
        generated_at: at(0),
        rule_files_hash: 'h',
        rules: [rule('RL-old'), rule('RL-new')],
      } as never),
    );
    gate.pass = true;
    const run = endStage(root, 'rule_scripts', [], clockAt(3));
    expect(run.rule_checks_flagged).toEqual(['RL-new']);
    expect(run.stages.rule_scripts.status).toBe('done');
    expect(readChoices(root)).toMatchObject([{ kind: 'rule_checks_warn_only', choice: 'RL-new' }]);
  });

  it('flags every checked rule when no rules were recorded before step 5', () => {
    seedRun(root);
    doneBefore('rule_scripts');
    gate.pass = true;
    const run = endStage(root, 'rule_scripts', [], clockAt(3));
    expect(run.rule_checks_flagged).toBeUndefined();
    expect(readChoices(root)).toEqual([]);
  });
});

describe('resume and abandon (AC-3, FR-27)', () => {
  beforeEach(() => {
    seedRun(root, { owner_session: 'owner' });
  });

  it('refuses to resume or abandon a finished journey', () => {
    updateRun(root, (draft) => void (draft.status = 'done'));
    expect(() => resumeRun(root, 'owner', clockAt(2))).toThrow('there is nothing to resume');
    expect(() => abandonRun(root, clockAt(2))).toThrow('This onboarding journey is finished.');
  });

  it('resumes with no session and no current step when every step is done', () => {
    updateRun(root, (draft) => {
      for (const stage of ONBOARDING_STAGES) draft.stages[stage.id] = { status: 'done' };
      draft.status = 'paused';
    });
    const outcome = resumeRun(root, null, clockAt(2));
    expect(outcome).toMatchObject({ stage: null, units_todo: [], handover: false });
    expect(readRun(root)?.status).toBe('running');
    expect(readEvents(root).at(-1)).toMatchObject({ kind: 'stage', action: 'resume' });
    expect(readEvents(root).at(-1)?.stage).toBeUndefined();
  });

  it('resumes module docs without a module map and keeps its plan as it was', () => {
    doneBefore('module_docs');
    updateRun(root, (draft) => void (draft.stages.module_docs.plan = ['billing']));
    const outcome = resumeRun(root, 'owner', clockAt(2));
    expect(outcome.stage).toBe('module_docs');
    expect(outcome.run.stages.module_docs.plan).toEqual(['billing']);
  });
});
