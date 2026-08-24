import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { classifySessionRouteForEnforcement } from '@/pipeline/route-enforcement.js';
import { writeWorkflowState } from '@/pipeline/workflow-state.js';

// Issue #499 — the enforcement-grade route classifier: it distinguishes an absent /
// unknown route (fail-closed) from an affirmatively non-feature route (skip), and
// consults BOTH the active and paused entries so a paused feature-development change
// still enforces.

const roots: string[] = [];
function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'paqad-route-enforce-'));
  roots.push(root);
  return root;
}
afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

const SES = 'ses_route_enforce';

describe('classifySessionRouteForEnforcement', () => {
  it('returns unknown when no route state exists (fail-closed)', () => {
    const root = tempRoot();
    const result = classifySessionRouteForEnforcement(root, SES);
    expect(result.verdict).toBe('unknown');
    expect(result.activeWorkflow).toBeNull();
  });

  it('returns non-feature when the active route is a non-feature workflow', () => {
    const root = tempRoot();
    writeWorkflowState(root, SES, { active: { workflow: 'project-question' }, paused: [] });
    const result = classifySessionRouteForEnforcement(root, SES);
    expect(result.verdict).toBe('non-feature');
    expect(result.activeWorkflow).toBe('project-question');
  });

  it('returns feature-dev when the active route is feature-development', () => {
    const root = tempRoot();
    writeWorkflowState(root, SES, { active: { workflow: 'feature-development' }, paused: [] });
    expect(classifySessionRouteForEnforcement(root, SES).verdict).toBe('feature-dev');
  });

  it('returns feature-dev when a PAUSED entry is feature-development (detour to a question)', () => {
    const root = tempRoot();
    writeWorkflowState(root, SES, {
      active: { workflow: 'project-question' },
      paused: [{ workflow: 'feature-development' }],
    });
    const result = classifySessionRouteForEnforcement(root, SES);
    expect(result.verdict).toBe('feature-dev');
    // The active workflow is still the non-feature detour; the verdict overrides on paused.
    expect(result.activeWorkflow).toBe('project-question');
  });

  it('reads unknown for an empty state file (indistinguishable from absent)', () => {
    const root = tempRoot();
    writeWorkflowState(root, SES, { active: null, paused: [] });
    expect(classifySessionRouteForEnforcement(root, SES).verdict).toBe('unknown');
  });
});
