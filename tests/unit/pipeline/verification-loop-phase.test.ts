import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { VerificationLoopPhase } from '@/pipeline/phases/verification-loop.js';
import { BUILD_CHECK_FIX_ROUNDS_RELATIVE_PATH } from '@/loop/rounds-log.js';
import type { PhaseExecutor } from '@/pipeline/phases/phase.interface.js';
import type { PhaseResult, PipelineRunContext } from '@/core/types/pipeline.js';
import type { FeatureDevelopmentRoundsPolicy } from '@/core/types/feature-development-policy.js';
import type { Lane } from '@/core/types/routing.js';

class ScriptedVerificationPhase implements PhaseExecutor {
  readonly phase = 'verification-gates' as const;
  calls = 0;

  constructor(
    private readonly script: (call: number, context: PipelineRunContext) => PhaseResult,
  ) {}

  async execute(context: PipelineRunContext): Promise<PhaseResult> {
    this.calls += 1;
    return this.script(this.calls, context);
  }
}

function makeContext(
  projectRoot: string,
  lane: Lane,
  rounds?: FeatureDevelopmentRoundsPolicy,
): PipelineRunContext {
  return {
    project_root: projectRoot,
    lane,
    classification: { workflow: 'feature-development' },
    started_at: 't0',
    phases: [],
    feature_policy: rounds ? ({ rounds } as PipelineRunContext['feature_policy']) : null,
    policy_warnings: [],
  } as unknown as PipelineRunContext;
}

function passResult(): PhaseResult {
  return {
    phase: 'verification-gates',
    status: 'pass',
    summary: 'Verification gates passed',
    artifacts: [],
  };
}

function failResult(context: PipelineRunContext): PhaseResult {
  context.verification_results = [
    { gate: 'code-tests-lint', passed: false, detail: 'a test failed' },
  ] as PipelineRunContext['verification_results'];
  return {
    phase: 'verification-gates',
    status: 'fail',
    summary: 'Verification blocked (code-tests-lint: a test failed)',
    artifacts: [],
  };
}

describe('VerificationLoopPhase', () => {
  it('is transparent when round 1 passes — hands back the inner pass result', async () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-vloop-pass-'));
    const inner = new ScriptedVerificationPhase(() => passResult());
    const phase = new VerificationLoopPhase(inner, { now: () => 't' });

    const result = await phase.execute(makeContext(root, 'fast'));

    expect(result.status).toBe('pass');
    expect(inner.calls).toBe(1);
    const log = JSON.parse(readFileSync(join(root, BUILD_CHECK_FIX_ROUNDS_RELATIVE_PATH), 'utf8'));
    expect(log.status).toBe('done');
    expect(log.rounds_used).toBe(1);
  });

  it('emits exactly one honest stop report when the check keeps failing', async () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-vloop-fail-'));
    const inner = new ScriptedVerificationPhase((_, context) => failResult(context));
    const phase = new VerificationLoopPhase(inner, { now: () => 't' });

    const result = await phase.execute(makeContext(root, 'fast'));

    expect(result.status).toBe('fail');
    expect(result.summary.startsWith('stop:')).toBe(true);
    expect(result.summary).toContain('code-tests-lint');
    // Futility (K=2) stops after two identical failing rounds.
    expect(inner.calls).toBe(2);
    expect(result.artifacts).toContain(BUILD_CHECK_FIX_ROUNDS_RELATIVE_PATH);

    const log = JSON.parse(readFileSync(join(root, BUILD_CHECK_FIX_ROUNDS_RELATIVE_PATH), 'utf8'));
    expect(log.status).toBe('stopped-futility');
    expect(log.stuck_report).not.toBeNull();
    expect(log.rounds).toHaveLength(2);
  });

  it('caps rounds at a project override before futility would trip', async () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-vloop-cap-'));
    const inner = new ScriptedVerificationPhase((_, context) => failResult(context));
    const phase = new VerificationLoopPhase(inner, { now: () => 't' });

    const result = await phase.execute(makeContext(root, 'fast', { fast: 1 }));

    expect(result.status).toBe('fail');
    expect(inner.calls).toBe(1);
    const log = JSON.parse(readFileSync(join(root, BUILD_CHECK_FIX_ROUNDS_RELATIVE_PATH), 'utf8'));
    expect(log.status).toBe('stopped-at-cap');
    expect(log.max_rounds).toBe(1);
    expect(existsSync(join(root, BUILD_CHECK_FIX_ROUNDS_RELATIVE_PATH))).toBe(true);
  });
});
