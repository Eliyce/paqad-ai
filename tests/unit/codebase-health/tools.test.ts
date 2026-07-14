import { describe, expect, it } from 'vitest';

import {
  HEALTH_TOOLS,
  healthToolSpec,
  isToolAvailable,
  resolveToolAvailability,
} from '@/codebase-health/tools.js';

describe('HEALTH_TOOLS / healthToolSpec', () => {
  it('registers the four scanners with install hints', () => {
    expect(HEALTH_TOOLS.map((t) => t.tool)).toEqual(['osv-scanner', 'gitleaks', 'jscpd', 'knip']);
    expect(healthToolSpec('gitleaks')?.install_hint).toContain('gitleaks');
    expect(healthToolSpec('nope')).toBeUndefined();
  });
});

describe('resolveToolAvailability', () => {
  it('reports a present binary available and an absent one unavailable', () => {
    const availability = resolveToolAvailability([
      { tool: 'node', used_for: ['dead-code'], requires_network: false, install_hint: 'x' },
      {
        tool: 'definitely-not-a-real-binary-xyz',
        used_for: ['duplication'],
        requires_network: false,
        install_hint: 'y',
      },
    ]);
    expect(availability.find((a) => a.tool === 'node')?.available).toBe(true);
    expect(availability.find((a) => a.tool === 'definitely-not-a-real-binary-xyz')?.available).toBe(
      false,
    );
  });

  it('defaults to the HEALTH_TOOLS list', () => {
    expect(resolveToolAvailability()).toHaveLength(HEALTH_TOOLS.length);
  });
});

describe('isToolAvailable', () => {
  it('reflects the availability list', () => {
    const availability = [
      { tool: 'node', available: true, used_for: ['dead-code' as const] },
      { tool: 'jscpd', available: false, used_for: ['duplication' as const] },
    ];
    expect(isToolAvailable(availability, 'node')).toBe(true);
    expect(isToolAvailable(availability, 'jscpd')).toBe(false);
    expect(isToolAvailable(availability, 'missing')).toBe(false);
  });
});
