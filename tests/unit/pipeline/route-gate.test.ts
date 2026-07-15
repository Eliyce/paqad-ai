import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { routeIsAffirmativelyNonFeature } from '@/pipeline/route-gate.js';
import { writeSessionRoute } from '@/pipeline/session-route.js';
import { writeWorkflowState } from '@/pipeline/workflow-state.js';

describe('routeIsAffirmativelyNonFeature (#390)', () => {
  let root: string;
  const SES = 'ses_route_gate';

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-route-gate-'));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('is false when the active route is feature-development', () => {
    writeWorkflowState(root, SES, { active: { workflow: 'feature-development' }, paused: [] });
    expect(routeIsAffirmativelyNonFeature(root, SES)).toBe(false);
  });

  it('is true when the active route is a non-feature workflow', () => {
    writeWorkflowState(root, SES, { active: { workflow: 'root-cause-analysis' }, paused: [] });
    expect(routeIsAffirmativelyNonFeature(root, SES)).toBe(true);
  });

  it('is false when NO route state exists (unknown → cross-provider safe)', () => {
    // Codex/Gemini never write route state; absence must NOT read as non-feature, or
    // their feature-evidence recording would be silently killed.
    expect(routeIsAffirmativelyNonFeature(root, SES)).toBe(false);
  });

  it('falls back to the session-route pointer when no active workflow-state entry exists', () => {
    // No workflow-state active entry, but the session-agnostic route pointer says pentest.
    writeSessionRoute(root, { workflow: 'pentest', query: 'check the app' });
    expect(routeIsAffirmativelyNonFeature(root, SES)).toBe(true);
  });

  it('falls back to the session-route pointer for a feature-development route', () => {
    writeSessionRoute(root, { workflow: 'feature-development', query: 'fix the bug' });
    expect(routeIsAffirmativelyNonFeature(root, SES)).toBe(false);
  });
});
