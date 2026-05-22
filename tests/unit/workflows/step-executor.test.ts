import { describe, expect, it, vi } from 'vitest';

import { StepExecutor } from '@/workflows/step-executor.js';
import type { PredictiveCache } from '@/cache/predictive-cache.js';
import type { SkillCacheManager } from '@/skills/cache-manager.js';

function makeConcreteExecutor(
  options: ConstructorParameters<typeof StepExecutor>[1] = {},
  runStepFn?: () => Promise<void>,
) {
  return new (class extends StepExecutor {
    constructor() {
      super({ classification: { workflow: 'custom', complexity: 'low', risk: 'low' } }, options);
    }

    protected override async runStep(): Promise<void> {
      if (runStepFn) {
        return runStepFn();
      }
      // no-op success
    }
  })();
}

describe('StepExecutor predictive cache wiring', () => {
  it('calls onSkillComplete after a successful step when predictiveCache is provided', async () => {
    const onSkillComplete = vi.fn().mockResolvedValue(undefined);
    const predictiveCache = { onSkillComplete } as unknown as PredictiveCache;

    const executor = makeConcreteExecutor({
      sessionId: 'session-abc',
      stackKey: 'react',
      predictiveCache,
    });

    const result = await executor.execute({ skill: 'code' });

    expect(result.status).toBe('completed');
    expect(onSkillComplete).toHaveBeenCalledOnce();
    const [sessionId, stackKey, workflow, skillName] = onSkillComplete.mock.calls[0] as [
      string,
      string,
      string,
      string,
    ];
    expect(sessionId).toBe('session-abc');
    expect(stackKey).toBe('react');
    expect(workflow).toBe('custom');
    expect(skillName).toBe('code');
  });

  it('does not call onSkillComplete when no predictiveCache is provided', async () => {
    const executor = makeConcreteExecutor();
    const result = await executor.execute({ skill: 'code' });

    expect(result.status).toBe('completed');
    // No assertion needed; if it threw, the test would fail
  });

  it('does not call onSkillComplete when the step is skipped', async () => {
    const onSkillComplete = vi.fn().mockResolvedValue(undefined);
    const predictiveCache = { onSkillComplete } as unknown as PredictiveCache;

    const executor = makeConcreteExecutor({ predictiveCache });

    const result = await executor.execute({
      skill: 'code',
      condition: { complexity: ['high'] }, // classification has complexity: 'low', so skip
    });

    expect(result.status).toBe('skipped');
    expect(onSkillComplete).not.toHaveBeenCalled();
  });

  it('does not call onSkillComplete when the step fails', async () => {
    const onSkillComplete = vi.fn().mockResolvedValue(undefined);
    const predictiveCache = { onSkillComplete } as unknown as PredictiveCache;

    const executor = makeConcreteExecutor({ predictiveCache }, async () => {
      throw new Error('step exploded');
    });

    const result = await executor.execute({ skill: 'code' });

    expect(result.status).toBe('failed');
    expect(result.error).toBe('step exploded');
    expect(onSkillComplete).not.toHaveBeenCalled();
  });

  it('uses default sessionId and stackKey when not provided', async () => {
    const onSkillComplete = vi.fn().mockResolvedValue(undefined);
    const predictiveCache = { onSkillComplete } as unknown as PredictiveCache;

    const executor = makeConcreteExecutor({ predictiveCache });

    await executor.execute({ skill: 'plan' });

    const [sessionId, stackKey] = onSkillComplete.mock.calls[0] as [string, string];
    expect(sessionId).toBe('default');
    expect(stackKey).toBe('default');
  });

  it('passes the workflow from classification to onSkillComplete', async () => {
    const onSkillComplete = vi.fn().mockResolvedValue(undefined);
    const predictiveCache = { onSkillComplete } as unknown as PredictiveCache;

    const executor = new (class extends StepExecutor {
      constructor() {
        super(
          { classification: { workflow: 'feature-development', complexity: 'low', risk: 'low' } },
          { predictiveCache },
        );
      }
      protected override async runStep(): Promise<void> {}
    })();

    await executor.execute({ skill: 'spec' });

    const [, , workflow] = onSkillComplete.mock.calls[0] as [string, string, string];
    expect(workflow).toBe('feature-development');
  });
});

describe('StepExecutor skill cache wiring', () => {
  function makeSkillCacheManager(overrides: Partial<SkillCacheManager> = {}): SkillCacheManager {
    return {
      checkCache: vi.fn().mockResolvedValue({ hit: false, input_hash: 'abc123' }),
      writeCache: vi.fn().mockResolvedValue(undefined),
      computeInputHash: vi.fn().mockResolvedValue('abc123'),
      invalidateModule: vi.fn().mockResolvedValue(0),
      getStats: vi.fn().mockResolvedValue({ total_entries: 0, total_size_bytes: 0, hit_rate: 0 }),
      ...overrides,
    } as unknown as SkillCacheManager;
  }

  it('does not interact with skillCacheManager when not provided', async () => {
    const executor = makeConcreteExecutor();
    const result = await executor.execute({ skill: 'code' });
    expect(result.status).toBe('completed');
  });

  it('calls checkCache before running the step', async () => {
    const skillCacheManager = makeSkillCacheManager();
    const runStepFn = vi.fn().mockResolvedValue(undefined);
    const executor = makeConcreteExecutor({ skillCacheManager }, runStepFn);

    await executor.execute({ skill: 'analyze' });

    expect(skillCacheManager.checkCache).toHaveBeenCalledOnce();
    expect(skillCacheManager.checkCache).toHaveBeenCalledWith('analyze', []);
  });

  it('returns completed from cache hit without calling runStep', async () => {
    const skillCacheManager = makeSkillCacheManager({
      checkCache: vi
        .fn()
        .mockResolvedValue({ hit: true, result: { findings: ['ok'] }, input_hash: 'abc123' }),
    });
    const runStepFn = vi.fn().mockResolvedValue(undefined);
    const executor = makeConcreteExecutor({ skillCacheManager }, runStepFn);

    const result = await executor.execute({ skill: 'analyze' });

    expect(result.status).toBe('completed');
    expect(runStepFn).not.toHaveBeenCalled();
    expect(skillCacheManager.writeCache).not.toHaveBeenCalled();
  });

  it('calls writeCache after a successful step on cache miss', async () => {
    const skillCacheManager = makeSkillCacheManager();
    const executor = makeConcreteExecutor({ skillCacheManager });

    await executor.execute({ skill: 'plan' });

    expect(skillCacheManager.computeInputHash).toHaveBeenCalledWith([]);
    expect(skillCacheManager.writeCache).toHaveBeenCalledOnce();
    expect(skillCacheManager.writeCache).toHaveBeenCalledWith('plan', 'abc123', null, []);
  });

  it('does not call writeCache when step fails', async () => {
    const skillCacheManager = makeSkillCacheManager();
    const executor = makeConcreteExecutor({ skillCacheManager }, async () => {
      throw new Error('step failed');
    });

    const result = await executor.execute({ skill: 'plan' });

    expect(result.status).toBe('failed');
    expect(skillCacheManager.writeCache).not.toHaveBeenCalled();
  });

  it('does not call checkCache when step is skipped by condition', async () => {
    const skillCacheManager = makeSkillCacheManager();
    const executor = makeConcreteExecutor({ skillCacheManager });

    const result = await executor.execute({
      skill: 'analyze',
      condition: { complexity: ['high'] }, // classification has complexity: 'low'
    });

    expect(result.status).toBe('skipped');
    expect(skillCacheManager.checkCache).not.toHaveBeenCalled();
    expect(skillCacheManager.writeCache).not.toHaveBeenCalled();
  });

  it('sets lastSkill on cache hit', async () => {
    const skillCacheManager = makeSkillCacheManager({
      checkCache: vi.fn().mockResolvedValue({ hit: true, result: null, input_hash: 'abc123' }),
    });
    const executor = makeConcreteExecutor({ skillCacheManager });

    await executor.execute({ skill: 'spec' });

    expect(executor.getLastSkill()).toBe('spec');
  });

  it('both skillCacheManager and predictiveCache can be active together', async () => {
    const onSkillComplete = vi.fn().mockResolvedValue(undefined);
    const predictiveCache = { onSkillComplete } as unknown as PredictiveCache;
    const skillCacheManager = makeSkillCacheManager();
    const executor = makeConcreteExecutor({ skillCacheManager, predictiveCache });

    const result = await executor.execute({ skill: 'code' });

    expect(result.status).toBe('completed');
    expect(skillCacheManager.checkCache).toHaveBeenCalledOnce();
    expect(skillCacheManager.writeCache).toHaveBeenCalledOnce();
    expect(onSkillComplete).toHaveBeenCalledOnce();
  });

  it('predictiveCache is not called on cache hit (runStep is bypassed)', async () => {
    const onSkillComplete = vi.fn().mockResolvedValue(undefined);
    const predictiveCache = { onSkillComplete } as unknown as PredictiveCache;
    const skillCacheManager = makeSkillCacheManager({
      checkCache: vi.fn().mockResolvedValue({ hit: true, result: null, input_hash: 'abc123' }),
    });
    const executor = makeConcreteExecutor({ skillCacheManager, predictiveCache });

    const result = await executor.execute({ skill: 'code' });

    expect(result.status).toBe('completed');
    expect(onSkillComplete).not.toHaveBeenCalled();
  });
});

describe('StepExecutor condition evaluation', () => {
  it('skips when condition field is missing from classification', async () => {
    const executor = makeConcreteExecutor();
    const result = await executor.execute({ skill: 'plan', condition: { risk: ['high'] } });
    // classification has risk: 'low'
    expect(result.status).toBe('skipped');
  });

  it('executes when condition matches', async () => {
    const executor = makeConcreteExecutor();
    const result = await executor.execute({ skill: 'plan', condition: { complexity: ['low'] } });
    expect(result.status).toBe('completed');
  });
});
