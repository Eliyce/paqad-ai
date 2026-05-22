import { describe, expect, it } from 'vitest';

import {
  buildDocumentationDriftDeltaPayload,
  buildVerificationGateDeltaPayload,
  toVerificationSnapshots,
} from '@/verification/delta.js';

describe('verification delta helpers', () => {
  it('maps gate results into verification snapshots', () => {
    expect(
      toVerificationSnapshots([
        {
          gate: 'code-tests-lint',
          passed: false,
          detail: 'lint failed',
          remediation: 'run lint --fix',
        },
      ]),
    ).toEqual([
      {
        gate: 'code-tests-lint',
        passed: false,
        detail: 'lint failed',
        remediation: 'run lint --fix',
      },
    ]);
  });

  it('builds verification and documentation drift delta payloads', () => {
    const verification = buildVerificationGateDeltaPayload(
      [{ gate: 'code-tests-lint', passed: true, detail: 'clean' }],
      [{ gate: 'code-tests-lint', passed: false, detail: 'lint failed', remediation: 'fix lint' }],
      { contradiction_detected: true },
    );

    expect(verification.delta.changed_gate_outcomes).toEqual([
      { gate: 'code-tests-lint', before_passed: true, after_passed: false },
    ]);
    expect(verification.payload.escalation_reason).toBe('compact-signals-contradict');

    const documentation = buildDocumentationDriftDeltaPayload(
      [{ file: 'docs/spec.md', status: 'ok', conclusion: 'aligned' }],
      [{ file: 'docs/spec.md', status: 'stale', conclusion: 'needs refresh' }],
    );
    expect(documentation.delta.changed_files).toEqual(['docs/spec.md']);
    expect(documentation.payload.metadata.delta_mode_used).toBe(true);
  });
});
