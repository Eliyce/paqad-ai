import { describe, expect, it, vi } from 'vitest';

vi.mock('@/kernel/registry.js', async () => {
  const actual =
    await vi.importActual<typeof import('@/kernel/registry.js')>('@/kernel/registry.js');
  return {
    ...actual,
    capabilitiesForSeam: () => [
      {
        id: 'not-yet-folded',
        title: 'Not yet folded',
        modeKey: null,
        enforcementFloor: 'observe',
        seam: ['pre-mutation'],
        ledgerDocType: null,
        policySchemaVersion: 1,
        recordSchemaVersion: 1,
      },
    ],
  };
});

import { runCapabilityGate } from '@/kernel/gate.js';

describe('runCapabilityGate — forward-compat skip', () => {
  it('skips a seam-bound descriptor with no kernel impl (clean allow, no throw)', async () => {
    const result = await runCapabilityGate({
      projectRoot: '/tmp/paqad-gate-skip-does-not-matter',
      seam: 'pre-mutation',
    });
    expect(result.block).toBe(false);
    expect(result.summary).toBe('');
    expect(result.narration ?? '').toBe('');
  });
});
