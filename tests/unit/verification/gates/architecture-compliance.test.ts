import { describe, expect, it } from 'vitest';

import { ArchitectureComplianceGate } from '@/verification/gates/architecture-compliance.js';

import { createVerificationContext } from '../shared.fixture.js';

describe('ArchitectureComplianceGate', () => {
  it('fails when architecture compliance fails', async () => {
    await expect(
      new ArchitectureComplianceGate().check(
        createVerificationContext({ architecture_compliant: false }),
      ),
    ).resolves.toMatchObject({ passed: false });
  });
});
