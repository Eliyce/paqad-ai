import { describe, expect, it, vi } from 'vitest';

import * as deltaDetector from '@/pipeline/delta-detector.js';
import * as ruleTriggerMatcher from '@/pipeline/rule-trigger-matcher.js';
import * as scopeResolver from '@/pipeline/scope-resolver.js';
import { ModuleResolver } from '@/pipeline/module-resolver.js';
import { PreClassifier } from '@/pipeline/pre-classifier.js';

describe('PreClassifier', () => {
  it('resolves deterministic workflow, modules, and context metadata', async () => {
    vi.spyOn(ModuleResolver.prototype, 'resolve').mockResolvedValue({
      modules: [{ path: 'src/api/users', source: 'explicit-path', confidence: 1 }],
      source: 'explicit-path',
    });

    const result = await new PreClassifier(process.cwd()).classify({
      request: 'Implement api users feature',
      profile: {
        stack_profile: {
          frameworks: ['react'],
          traits: [],
          toolchains: [],
          version_bands: [],
          sources: [],
        },
      },
    });

    expect(result.resolved.workflow).toBe('feature-development');
    expect(result.resolved.affected_modules).toEqual(['src/api/users']);
    expect(result.resolved.context_budget_hint).toBe('minimal');
    expect(result.resolution_map.workflow).toBe('deterministic');
  });

  it('tracks unresolved workflow when no pattern matches', async () => {
    vi.spyOn(ModuleResolver.prototype, 'resolve').mockResolvedValue({
      modules: [],
      source: 'default',
    });

    const result = await new PreClassifier(process.cwd()).classify({
      request: 'do the thing',
    });

    expect(result.unresolved).toContain('workflow');
  });

  it('falls back on timeout', async () => {
    vi.spyOn(ModuleResolver.prototype, 'resolve').mockImplementation(
      () => new Promise(() => undefined),
    );

    const result = await new PreClassifier(process.cwd()).classify({
      request: 'implement feature',
    });

    expect(result.evidence).toContain('timeout');
    expect(result.unresolved).toContain('affected_modules');
  });

  it('marks scope as unresolved and uses default when resolveScope rejects', async () => {
    vi.spyOn(ModuleResolver.prototype, 'resolve').mockResolvedValue({
      modules: [{ path: 'src/api/users', source: 'explicit-path', confidence: 1 }],
      source: 'explicit-path',
    });
    vi.spyOn(scopeResolver, 'resolveScope').mockRejectedValue(new Error('scope failure'));

    const result = await new PreClassifier(process.cwd()).classify({
      request: 'implement feature',
    });

    expect(result.unresolved).toContain('scope');
    expect(result.resolved.scope).toBe('single-module');
    expect(result.resolution_map.scope).toBe('default');
  });

  it('marks delta_candidate as unresolved when detectDeltaCandidate rejects', async () => {
    vi.spyOn(ModuleResolver.prototype, 'resolve').mockResolvedValue({
      modules: [{ path: 'src/api/users', source: 'explicit-path', confidence: 1 }],
      source: 'explicit-path',
    });
    vi.spyOn(deltaDetector, 'detectDeltaCandidate').mockRejectedValue(new Error('delta failure'));

    const result = await new PreClassifier(process.cwd()).classify({
      request: 'implement feature',
    });

    expect(result.unresolved).toContain('delta_candidate');
    expect(result.resolved.delta_candidate).toBe(false);
  });

  it('marks matched_rule_triggers as unresolved when matchRuleTriggers rejects', async () => {
    vi.spyOn(ModuleResolver.prototype, 'resolve').mockResolvedValue({
      modules: [{ path: 'src/api/users', source: 'explicit-path', confidence: 1 }],
      source: 'explicit-path',
    });
    vi.spyOn(ruleTriggerMatcher, 'matchRuleTriggers').mockRejectedValue(
      new Error('rule trigger failure'),
    );

    const result = await new PreClassifier(process.cwd()).classify({
      request: 'implement feature',
    });

    expect(result.unresolved).toContain('matched_rule_triggers');
    expect(result.resolved.matched_rule_triggers).toEqual([]);
  });

  it('routes module-documentation prompts to module-documentation, not documentation-update', async () => {
    vi.spyOn(ModuleResolver.prototype, 'resolve').mockResolvedValue({
      modules: [],
      source: 'default',
    });

    const variants = [
      'generate module docs',
      'create module documentation',
      'generate module documentation',
      'create per module docs',
    ];

    for (const request of variants) {
      const result = await new PreClassifier(process.cwd()).classify({ request });
      expect(result.resolved.workflow, `"${request}" should resolve to module-documentation`).toBe(
        'module-documentation',
      );
    }
  });

  it('still routes plain documentation prompts to documentation-update', async () => {
    vi.spyOn(ModuleResolver.prototype, 'resolve').mockResolvedValue({
      modules: [],
      source: 'default',
    });

    const result = await new PreClassifier(process.cwd()).classify({
      request: 'create documentation for this project',
    });

    expect(result.resolved.workflow).toBe('documentation-update');
  });

  it('routes health prompts to codebase-health while pentest phrasings stay pentest (#355 AC-6)', async () => {
    vi.spyOn(ModuleResolver.prototype, 'resolve').mockResolvedValue({
      modules: [],
      source: 'default',
    });

    const healthPrompts = [
      "can you check my project's health?",
      'run a codebase health audit',
      'find dead code in this repo',
    ];
    for (const request of healthPrompts) {
      const result = await new PreClassifier(process.cwd()).classify({ request });
      expect(result.resolved.workflow, `"${request}" → codebase-health`).toBe('codebase-health');
    }

    const retest = await new PreClassifier(process.cwd()).classify({
      request: 'run a health retest',
    });
    expect(retest.resolved.workflow).toBe('health-retest');

    const pentest = await new PreClassifier(process.cwd()).classify({
      request: 'run a pentest of the app',
    });
    expect(pentest.resolved.workflow).toBe('pentest');
  });
});
