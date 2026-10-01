import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { FrameworkError } from '@/core/errors/index.js';
import {
  advanceSetupStep,
  buildSetupPlan,
  readSetupPlan,
  validateSetupPlan,
  writeSetupPlan,
  type SetupStepInput,
} from '@/onboarding/setup-plan.js';

const STEPS: SetupStepInput[] = [
  {
    id: 'runtime',
    description: 'Install the language runtime',
    command: 'mise install node@22',
    verify: 'node --version',
    recovery: 'Install mise from https://mise.jdx.dev, then re-run.',
    version: '22',
  },
  {
    id: 'deps',
    description: 'Install project dependencies',
    command: 'pnpm install',
    verify: 'pnpm list',
    recovery: 'Install pnpm with `corepack enable`, then re-run.',
    prerequisite: 'runtime',
  },
];

describe('buildSetupPlan', () => {
  it('assigns pending to every step and preserves dependency order (FR-5, AC-6)', () => {
    const plan = buildSetupPlan({
      projectRoot: '/tmp/demo',
      slice: '#596 slice 3',
      steps: STEPS,
      now: () => new Date('2026-10-01T00:00:00.000Z'),
    });

    expect(plan.schema_version).toBe('1');
    expect(plan.created_at).toBe('2026-10-01T00:00:00.000Z');
    expect(plan.steps.map((step) => step.id)).toEqual(['runtime', 'deps']);
    expect(plan.steps.every((step) => step.state === 'pending')).toBe(true);
  });

  it('records the slice scope and carries no "parent complete" field (INV-2)', () => {
    const plan = buildSetupPlan({ projectRoot: '/tmp/demo', slice: '#596 slice 3', steps: STEPS });
    expect(plan.slice).toBe('#596 slice 3');
    // The record never claims the parent issue is done — it only names the slice it belongs to.
    expect(Object.keys(plan)).not.toContain('parent_complete');
    expect(JSON.stringify(plan)).not.toContain('parent_complete');
  });

  it('defaults created_at to the real clock when no injector is given', () => {
    const before = Date.now();
    const plan = buildSetupPlan({ projectRoot: '/tmp/demo', slice: 's', steps: STEPS });
    expect(Date.parse(plan.created_at)).toBeGreaterThanOrEqual(before);
  });
});

describe('validateSetupPlan (AC-6)', () => {
  it('accepts a well-formed, dependency-ordered plan', () => {
    const plan = buildSetupPlan({ projectRoot: '/tmp/demo', slice: 's', steps: STEPS });
    expect(validateSetupPlan(plan)).toEqual({ ok: true, errors: [] });
  });

  it('rejects a non-object', () => {
    for (const value of [null, 42, 'nope', ['steps']]) {
      const result = validateSetupPlan(value);
      expect(result.ok).toBe(false);
      expect(result.errors[0]).toContain('must be a JSON object');
    }
  });

  it('rejects an empty or missing steps array', () => {
    expect(validateSetupPlan({}).errors[0]).toContain('non-empty "steps"');
    expect(validateSetupPlan({ steps: [] }).errors[0]).toContain('non-empty "steps"');
    expect(validateSetupPlan({ steps: 'x' }).errors[0]).toContain('non-empty "steps"');
  });

  it('rejects a step missing a required non-empty field', () => {
    const plan = buildSetupPlan({ projectRoot: '/tmp/demo', slice: 's', steps: STEPS });
    plan.steps[0]!.command = '   ';
    const result = validateSetupPlan(plan);
    expect(result.ok).toBe(false);
    expect(result.errors.some((line) => line.includes('"command"'))).toBe(true);
  });

  it('rejects a non-object step entry', () => {
    const result = validateSetupPlan({ steps: [42] });
    expect(result.ok).toBe(false);
    expect(result.errors.some((line) => line.includes('must be an object'))).toBe(true);
  });

  it('rejects a duplicate step id', () => {
    const plan = buildSetupPlan({
      projectRoot: '/tmp/demo',
      slice: 's',
      steps: [STEPS[0]!, { ...STEPS[1]!, id: 'runtime', prerequisite: undefined }],
    });
    const result = validateSetupPlan(plan);
    expect(result.ok).toBe(false);
    expect(result.errors.some((line) => line.includes('duplicate step id "runtime"'))).toBe(true);
  });

  it('rejects a forward/unknown prerequisite reference', () => {
    const forward = buildSetupPlan({
      projectRoot: '/tmp/demo',
      slice: 's',
      // First step references a step that only appears LATER — a forward reference.
      steps: [
        { ...STEPS[0]!, prerequisite: 'deps' },
        { ...STEPS[1]!, prerequisite: undefined },
      ],
    });
    const forwardResult = validateSetupPlan(forward);
    expect(forwardResult.ok).toBe(false);
    expect(forwardResult.errors.some((line) => line.includes('prerequisite'))).toBe(true);

    const unknown = buildSetupPlan({
      projectRoot: '/tmp/demo',
      slice: 's',
      steps: [STEPS[0]!, { ...STEPS[1]!, prerequisite: 'nope' }],
    });
    const unknownResult = validateSetupPlan(unknown);
    expect(unknownResult.ok).toBe(false);
    expect(unknownResult.errors.some((line) => line.includes('"nope"'))).toBe(true);
  });

  it('rejects an invalid step state', () => {
    const plan = buildSetupPlan({ projectRoot: '/tmp/demo', slice: 's', steps: STEPS });
    (plan.steps[0] as { state: string }).state = 'done';
    const result = validateSetupPlan(plan);
    expect(result.ok).toBe(false);
    expect(result.errors.some((line) => line.includes('"state"'))).toBe(true);
  });
});

describe('writeSetupPlan / readSetupPlan', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'paqad-setup-plan-'));
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('round-trips the record to .paqad/setup-plan.json', () => {
    const plan = buildSetupPlan({ projectRoot, slice: 's', steps: STEPS });
    const written = writeSetupPlan(projectRoot, plan);
    expect(written).toBe(join(projectRoot, '.paqad', 'setup-plan.json'));
    expect(readSetupPlan(projectRoot)).toEqual(plan);
  });

  it('returns null when no record exists', () => {
    expect(readSetupPlan(projectRoot)).toBeNull();
  });

  it('returns null when the record is unreadable', () => {
    mkdirSync(join(projectRoot, '.paqad'), { recursive: true });
    writeFileSync(join(projectRoot, '.paqad', 'setup-plan.json'), '{ not json', 'utf8');
    expect(readSetupPlan(projectRoot)).toBeNull();
  });

  it('does not write inside any feature-evidence bundle dir', () => {
    const plan = buildSetupPlan({ projectRoot, slice: 's', steps: STEPS });
    const written = writeSetupPlan(projectRoot, plan);
    expect(written).not.toContain('feature-evidence');
    expect(readFileSync(written, 'utf8').endsWith('\n')).toBe(true);
  });
});

describe('advanceSetupStep (FR-6)', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'paqad-setup-step-'));
    writeSetupPlan(projectRoot, buildSetupPlan({ projectRoot, slice: 's', steps: STEPS }));
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('updates a step state and persists it', () => {
    const updated = advanceSetupStep(projectRoot, 'deps', 'blocked');
    expect(updated.steps.find((step) => step.id === 'deps')?.state).toBe('blocked');
    expect(readSetupPlan(projectRoot)?.steps.find((step) => step.id === 'deps')?.state).toBe(
      'blocked',
    );
  });

  it('throws a clear error on an unknown step id', () => {
    expect(() => advanceSetupStep(projectRoot, 'ghost', 'completed')).toThrow(FrameworkError);
    expect(() => advanceSetupStep(projectRoot, 'ghost', 'completed')).toThrow(/Unknown setup step/);
  });

  it('throws when no setup plan exists', () => {
    const empty = mkdtempSync(join(tmpdir(), 'paqad-setup-none-'));
    try {
      expect(() => advanceSetupStep(empty, 'runtime', 'completed')).toThrow(/No setup plan/);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});
