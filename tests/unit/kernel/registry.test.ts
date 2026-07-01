import { describe, expect, it } from 'vitest';

import { KNOWN_CONFIG_KEYS } from '@/core/framework-config';
import { CAPABILITY_REGISTRY, capabilitiesForSeam, getCapability } from '@/kernel/registry';

describe('CAPABILITY_REGISTRY (buildout F3 — the unifying data model)', () => {
  it('has five capabilities with unique, stable ids', () => {
    const ids = CAPABILITY_REGISTRY.map((c) => c.id);
    expect(ids).toEqual(['stages', 'rule-scripts', 'decision-pause', 'narration', 'delivery']);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every mode knob is a registered FRAMEWORK_CONFIG_SPEC (no silent/prunable key)', () => {
    for (const capability of CAPABILITY_REGISTRY) {
      if (capability.modeKey !== null) {
        expect(KNOWN_CONFIG_KEYS.has(capability.modeKey), capability.id).toBe(true);
      }
    }
  });

  it('unbindable capabilities have no seam and no ledger; bindable ones have a seam', () => {
    for (const capability of CAPABILITY_REGISTRY) {
      if (capability.enforcementFloor === 'unbindable') {
        expect(capability.seam, capability.id).toEqual([]);
      } else {
        expect(capability.seam.length, capability.id).toBeGreaterThan(0);
      }
    }
  });

  it('narration is honestly unbindable (no host seam observes chat output)', () => {
    const narration = getCapability('narration');
    expect(narration.enforcementFloor).toBe('unbindable');
    expect(narration.seam).toEqual([]);
    expect(narration.modeKey).toBeNull();
  });

  it('schema versions are positive integers (migrator seam)', () => {
    for (const capability of CAPABILITY_REGISTRY) {
      expect(
        Number.isInteger(capability.policySchemaVersion) && capability.policySchemaVersion >= 1,
      ).toBe(true);
      expect(
        Number.isInteger(capability.recordSchemaVersion) && capability.recordSchemaVersion >= 1,
      ).toBe(true);
    }
  });

  it('capabilitiesForSeam selects by host lifecycle point', () => {
    const pre = capabilitiesForSeam('pre-mutation').map((c) => c.id);
    expect(pre).toContain('rule-scripts');
    expect(pre).toContain('decision-pause');
    expect(pre).toContain('stages'); // block-forward runs pre-mutation (RCA fix B)
    expect(pre).not.toContain('narration');

    const completion = capabilitiesForSeam('completion').map((c) => c.id);
    expect(completion).toContain('stages');
    expect(completion).toContain('delivery');
  });

  it('getCapability throws on an unknown id', () => {
    // @ts-expect-error — exercising the runtime guard with an invalid id.
    expect(() => getCapability('nope')).toThrow(/Unknown capability/);
  });
});
