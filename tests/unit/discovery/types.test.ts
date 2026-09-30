import { describe, expect, it } from 'vitest';

import {
  DISCOVERY_EVIDENCE_DOC_TYPE,
  DISCOVERY_OUTCOMES,
  DISCOVERY_RUN_STATUSES,
  DISCOVERY_SCHEMA_VERSION,
  isDiscoveryOutcome,
  isDiscoveryRunStatus,
} from '@/discovery/types.js';

describe('discovery types', () => {
  it('names its own evidence doc type and a v1 schema', () => {
    expect(DISCOVERY_EVIDENCE_DOC_TYPE).toBe('paqad.discovery-evidence');
    expect(DISCOVERY_SCHEMA_VERSION).toBe(1);
  });

  it('separates execution status from hand-off outcome', () => {
    expect(DISCOVERY_RUN_STATUSES).toContain('blocked');
    expect(DISCOVERY_RUN_STATUSES).toContain('completed');
    expect(DISCOVERY_OUTCOMES).toContain('experiment');
    expect(DISCOVERY_OUTCOMES).toContain('deferred');
    // A status is never an outcome and vice versa.
    for (const status of DISCOVERY_RUN_STATUSES) {
      expect(DISCOVERY_OUTCOMES as readonly string[]).not.toContain(status);
    }
  });

  it('guards status and outcome values', () => {
    expect(isDiscoveryRunStatus('active')).toBe(true);
    expect(isDiscoveryRunStatus('done')).toBe(false);
    expect(isDiscoveryRunStatus(7)).toBe(false);
    expect(isDiscoveryOutcome('process_change')).toBe(true);
    expect(isDiscoveryOutcome('shipped')).toBe(false);
    expect(isDiscoveryOutcome(null)).toBe(false);
  });
});
