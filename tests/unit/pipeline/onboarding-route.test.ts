import { describe, expect, it } from 'vitest';

import { PreClassifier } from '@/pipeline/pre-classifier.js';
import { resolveRoutedWorkflow, routeWhileOnboarding } from '@/pipeline/routed-workflow.js';
import { routeWorkflow } from '@/pipeline/workflow-state.js';

describe('the onboarding route', () => {
  it.each([
    ['onboard paqad', 'onboarding'],
    ['please onboard paqad here', 'onboarding'],
    ['continue paqad onboarding', 'onboarding'],
    ['resume paqad onboarding', 'onboarding'],
  ])('FR-2: "%s" routes to %s', async (request, workflow) => {
    const result = await new PreClassifier(process.cwd()).classify({ request });
    expect(result.resolved.workflow).toBe(workflow);
    expect(resolveRoutedWorkflow(result.resolved.workflow)).toBe('onboarding');
  });

  it('keeps a plain onboarding idea on discovery', async () => {
    const result = await new PreClassifier(process.cwd()).classify({
      request: 'help me shape an idea for onboarding',
    });
    expect(result.resolved.workflow).toBe('discovery');
  });

  it('folds the inner workflows under onboarding only while a journey is open', () => {
    for (const inner of [
      'documentation-update',
      'module-documentation',
      'rules-discovery',
      'rules-analyze',
    ] as const) {
      expect(routeWhileOnboarding(inner, true)).toBe('onboarding');
      expect(routeWhileOnboarding(inner, false)).toBe(inner);
    }
    expect(routeWhileOnboarding('feature-development', true)).toBe('feature-development');
  });

  it('keeps the onboardingRunId anchor on the active entry', () => {
    const next = routeWorkflow({ active: null, paused: [] }, 'onboarding', {
      onboardingRunId: 'onb-1',
    });
    expect(next.state.active).toEqual({ workflow: 'onboarding', onboardingRunId: 'onb-1' });
  });
});
