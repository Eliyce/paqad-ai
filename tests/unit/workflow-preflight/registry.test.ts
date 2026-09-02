import { describe, expect, it } from 'vitest';

import { siteMapPreflightRequirements } from '@/site-map/preflight-requirements.js';
import { requirementsFor } from '@/workflow-preflight/registry.js';
import { runPreflight } from '@/workflow-preflight/run.js';

describe('requirementsFor', () => {
  it('maps site-map to its requirement list', () => {
    expect(requirementsFor('site-map')).toBe(siteMapPreflightRequirements);
  });

  it('returns an empty list for an unregistered workflow, never an error', () => {
    expect(requirementsFor('not-a-workflow')).toEqual([]);
  });
});

describe('runPreflight over the real registry', () => {
  it('a workflow with no declared requirements is ok with no questions (AC-2)', async () => {
    const result = await runPreflight('/proj', 'not-a-workflow');
    expect(result).toEqual({ ok: true, requirements: [], questions: [] });
  });
});
