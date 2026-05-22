import { describe, expect, it, vi } from 'vitest';

const { mockResume } = vi.hoisted(() => ({
  mockResume: vi.fn(),
}));

vi.mock('@/planning/slice-executor.js', () => ({
  SliceExecutor: class {
    resume = mockResume;
  },
}));

import { resumePlanExecution } from '@/cli/plan-resume.js';

describe('plan resume wrapper', () => {
  it('delegates directly to the slice executor', async () => {
    mockResume.mockResolvedValue({
      trackerPath: '/repo/.paqad/specs/demo.execution.json',
      resetSliceIds: ['SL-2'],
      currentSliceId: 'SL-2',
      warnings: [],
    });

    await expect(resumePlanExecution('/repo', 'demo')).resolves.toEqual({
      trackerPath: '/repo/.paqad/specs/demo.execution.json',
      resetSliceIds: ['SL-2'],
      currentSliceId: 'SL-2',
      warnings: [],
    });
    expect(mockResume).toHaveBeenCalledWith('/repo', 'demo');
  });
});
