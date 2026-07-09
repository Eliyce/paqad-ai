import { describe, expect, it } from 'vitest';

import { CLASSIFICATION_WORKFLOWS } from '@/core/types/classification.js';
import {
  ROUTED_WORKFLOWS,
  isFeatureDevelopmentRoute,
  resolveRoutedWorkflow,
  routeUsesRetrieval,
  type RoutedWorkflow,
} from '@/pipeline/routed-workflow.js';

describe('routed-workflow (#336)', () => {
  it('exposes exactly the 9 routing outcomes', () => {
    expect([...ROUTED_WORKFLOWS]).toEqual([
      'feature-development',
      'project-question',
      'documentation-update',
      'module-documentation',
      'pentest',
      'design-test',
      'rules-analyze',
      'root-cause-analysis',
      'no-workflow',
    ]);
  });

  it('maps null and undefined to no-workflow', () => {
    expect(resolveRoutedWorkflow(null)).toBe('no-workflow');
    expect(resolveRoutedWorkflow(undefined)).toBe('no-workflow');
  });

  it('folds every code-change intent into feature-development', () => {
    for (const workflow of [
      'feature-development',
      'bug-fix',
      'refactor',
      'migration',
      'cleanup',
      'architecture-change',
      'test-improvement',
      'schema-change',
      'query-optimization',
    ] as const) {
      expect(resolveRoutedWorkflow(workflow)).toBe('feature-development');
    }
  });

  it('routes read-and-understand intents to project-question', () => {
    expect(resolveRoutedWorkflow('project-question')).toBe('project-question');
    expect(resolveRoutedWorkflow('investigation')).toBe('project-question');
    expect(resolveRoutedWorkflow('ticket-refinement')).toBe('project-question');
  });

  it('maps the named non-code workflows to themselves', () => {
    expect(resolveRoutedWorkflow('documentation-update')).toBe('documentation-update');
    expect(resolveRoutedWorkflow('module-documentation')).toBe('module-documentation');
    expect(resolveRoutedWorkflow('pentest')).toBe('pentest');
    expect(resolveRoutedWorkflow('pentest-retest')).toBe('pentest');
    expect(resolveRoutedWorkflow('root-cause-analysis')).toBe('root-cause-analysis');
  });

  it('folds generic content intents into no-workflow', () => {
    for (const workflow of [
      'writing',
      'editing',
      'planning',
      'research',
      'content-update',
      'custom',
    ] as const) {
      expect(resolveRoutedWorkflow(workflow)).toBe('no-workflow');
    }
  });

  it('maps every classification workflow to a valid routing outcome (exhaustive)', () => {
    const valid = new Set<RoutedWorkflow>(ROUTED_WORKFLOWS);
    for (const workflow of CLASSIFICATION_WORKFLOWS) {
      expect(valid.has(resolveRoutedWorkflow(workflow))).toBe(true);
    }
  });

  it('treats only feature-development as the heavy (rules + lane + scripts) route', () => {
    for (const routed of ROUTED_WORKFLOWS) {
      expect(isFeatureDevelopmentRoute(routed)).toBe(routed === 'feature-development');
    }
  });

  it('retrieves for every outcome except no-workflow', () => {
    for (const routed of ROUTED_WORKFLOWS) {
      expect(routeUsesRetrieval(routed)).toBe(routed !== 'no-workflow');
    }
  });
});
