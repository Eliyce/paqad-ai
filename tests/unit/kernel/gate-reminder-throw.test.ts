import { describe, expect, it, vi } from 'vitest';

// Issue #579 — the first-frontend-edit reminder is advisory context. If anything on its path
// throws, the gate must still return the blocking outcome a capability produced in the same call
// (a throw out of runCapabilityGate soft-fails the host to exit 0, silently dropping the block).
vi.mock('@/visual-evidence/reminder.js', () => ({
  visualEvidenceReminder: () => {
    throw new Error('pack registry unreadable');
  },
}));

vi.mock('@/kernel/registry.js', async () => {
  const actual =
    await vi.importActual<typeof import('@/kernel/registry.js')>('@/kernel/registry.js');
  return {
    ...actual,
    capabilitiesForSeam: () => [
      {
        id: 'blocking-fake',
        title: 'Blocking fake',
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

vi.mock('@/kernel/capability.js', () => ({
  CAPABILITY_IMPLS: new Map([
    [
      'blocking-fake',
      {
        evaluate: async () => ({
          ran: true,
          blocking: true,
          summary: 'rules not loaded: run `paqad-ai rules load`',
        }),
      },
    ],
  ]),
}));

import { runCapabilityGate } from '@/kernel/gate.js';

describe('runCapabilityGate — reminder throw', () => {
  it('keeps the blocking outcome and falls back to no reminder when the reminder throws', async () => {
    const result = await runCapabilityGate({
      projectRoot: '/tmp/paqad-gate-reminder-throw-does-not-matter',
      seam: 'pre-mutation',
      payload: { targetPath: 'src/App.tsx' },
    });
    expect(result.block).toBe(true);
    expect(result.summary).toBe('rules not loaded: run `paqad-ai rules load`');
    expect(result.context).toBe('');
  });
});
