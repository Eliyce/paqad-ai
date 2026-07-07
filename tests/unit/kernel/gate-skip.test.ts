import { describe, expect, it, vi } from 'vitest';

// Forward-compat guard (gate.ts): a descriptor that binds to a seam but has NO
// entry in CAPABILITY_IMPLS is skipped cleanly — it keeps binding through its
// legacy path until it is folded into the kernel. Every real descriptor has an
// impl today, so this branch is only reachable by faking the registry: we mock
// `capabilitiesForSeam` to return a synthetic impl-less descriptor and assert the
// gate neither throws nor blocks on it. This pins the documented skip behavior so
// a future 6th contract added without an impl degrades to "no-op", never a crash.
vi.mock('@/kernel/registry.js', async () => {
  const actual =
    await vi.importActual<typeof import('@/kernel/registry.js')>('@/kernel/registry.js');
  return {
    ...actual,
    capabilitiesForSeam: () => [
      {
        // An id intentionally absent from CAPABILITY_IMPLS.
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
