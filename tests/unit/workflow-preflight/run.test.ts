import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PreflightRequirement, ProbeOutcome } from '@/workflow-preflight/contract.js';

const requirementsFor = vi.fn();
vi.mock('@/workflow-preflight/registry.js', () => ({ requirementsFor }));

const { evaluateRequirements, runPreflight } = await import('@/workflow-preflight/run.js');

function req(id: string, outcome: ProbeOutcome): PreflightRequirement {
  return {
    id,
    label: `${id} label`,
    kind: 'file',
    why: `why ${id}`,
    probe: vi.fn().mockResolvedValue(outcome),
    options: [{ id: 'accept', label: 'Accept', recommended: true }],
  };
}

describe('evaluateRequirements', () => {
  it('runs each probe with the project root and preserves declaration order (INV-1)', async () => {
    const requirements = [req('a', 'ok'), req('b', 'unavailable'), req('c', 'needs-decision')];
    const results = await evaluateRequirements(requirements, '/proj');

    expect(results.map((r) => r.id)).toEqual(['a', 'b', 'c']);
    expect(results.map((r) => r.outcome)).toEqual(['ok', 'unavailable', 'needs-decision']);
    for (const requirement of requirements) {
      expect(requirement.probe).toHaveBeenCalledWith('/proj');
    }
  });
});

describe('evaluateRequirements applies gate', () => {
  it('skips a requirement whose applies() is false, never probing it', async () => {
    const gated = req('gated', 'unavailable');
    gated.applies = () => false;
    const always = req('always', 'ok');
    const results = await evaluateRequirements([gated, always], '/proj');

    expect(results.map((r) => r.id)).toEqual(['always']);
    expect(gated.probe).not.toHaveBeenCalled();
  });

  it('keeps a requirement whose applies() is true', async () => {
    const gated = req('gated', 'ok');
    gated.applies = () => true;
    const results = await evaluateRequirements([gated], '/proj');
    expect(results.map((r) => r.id)).toEqual(['gated']);
  });
});

describe('runPreflight', () => {
  beforeEach(() => requirementsFor.mockReset());

  it('is ok with no questions when every probe is ok (AC-1)', async () => {
    requirementsFor.mockReturnValue([req('a', 'ok'), req('b', 'ok')]);
    const result = await runPreflight('/proj', 'demo');

    expect(result.ok).toBe(true);
    expect(result.questions).toEqual([]);
    expect(result.requirements.map((r) => r.outcome)).toEqual(['ok', 'ok']);
  });

  it('turns every non-ok probe into a question, in declaration order, and is not ok (AC-1/AC-3)', async () => {
    requirementsFor.mockReturnValue([
      req('a', 'ok'),
      req('b', 'unavailable'),
      req('c', 'needs-decision'),
    ]);
    const result = await runPreflight('/proj', 'demo');

    expect(result.ok).toBe(false);
    expect(result.questions.map((q) => q.id)).toEqual(['b', 'c']);
    expect(result.questions.map((q) => q.outcome)).toEqual(['unavailable', 'needs-decision']);
    expect(result.questions[0]?.why).toBe('why b');
  });
});
