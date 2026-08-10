import { describe, expect, it } from 'vitest';

import type { AppMap, Guard, Surface, TrustTier } from '@/core/types/site-map.js';
import {
  honestTrustTier,
  deriveTrustFindings,
  stampHonestTrustTiers,
  type AnchorState,
} from '@/site-map/trust.js';

function surface(overrides: Partial<Surface> = {}): Surface {
  return { id: 's', kind: 'page', label: 'S', ...overrides };
}

function guard(overrides: Partial<Guard> = {}): Guard {
  return { id: 'g', kind: 'role', label: 'G', ...overrides };
}

function map(overrides: Partial<AppMap> = {}): AppMap {
  return { schema_version: 1, app: { name: 'x', kind: 'cli' }, surfaces: [], ...overrides };
}

describe('honestTrustTier', () => {
  const cases: Array<[TrustTier | undefined, AnchorState, TrustTier]> = [
    // A broken anchor collapses every claim to unverified.
    ['human-confirmed', 'broken', 'unverified'],
    ['unverified', 'broken', 'unverified'],
    // A resolving anchor earns proven-in-code; a weaker claim is raised to it...
    ['unverified', 'resolves', 'proven-in-code'],
    ['inferred', 'resolves', 'proven-in-code'],
    // ...and a stronger claim stands (a live anchor cannot refute a test/human attestation).
    ['proven-by-test', 'resolves', 'proven-by-test'],
    ['human-confirmed', 'resolves', 'human-confirmed'],
    // A missing anchor caps a code/attestation claim down to inferred...
    ['proven-in-code', 'none', 'inferred'],
    ['human-confirmed', 'none', 'inferred'],
    // ...but leaves an already-weaker claim alone.
    ['unverified', 'none', 'unverified'],
    // An absent claim reads as the bare unverified default.
    [undefined, 'none', 'unverified'],
    [undefined, 'resolves', 'proven-in-code'],
  ];
  it.each(cases)('maps authored %s over a %s anchor to %s', (authored, state, expected) => {
    expect(honestTrustTier(authored, state)).toBe(expected);
  });
});

describe('deriveTrustFindings', () => {
  it('returns nothing when there is no map', () => {
    expect(deriveTrustFindings(null, [])).toEqual([]);
  });

  it('raises nothing for an element that declares no trust tier', () => {
    const m = map({ surfaces: [surface({ evidence: [{ file: 'gone.ts', line: 1 }] })] });
    expect(deriveTrustFindings(m, [{ file: 'gone.ts', line: 1, status: 'file-missing' }])).toEqual(
      [],
    );
  });

  it('raises nothing when the earned tier meets or beats the claim', () => {
    // proven-in-code claim on a resolving anchor: earned proven-in-code, not an overstatement.
    const m = map({
      surfaces: [surface({ trust: 'proven-in-code', evidence: [{ file: 'a.ts', line: 1 }] })],
    });
    expect(deriveTrustFindings(m, [{ file: 'a.ts', line: 1, status: 'resolved' }])).toEqual([]);
  });

  it('flags a surface whose claim outruns its broken evidence', () => {
    const m = map({
      surfaces: [surface({ trust: 'proven-in-code', evidence: [{ file: 'gone.ts', line: 1 }] })],
    });
    const [finding] = deriveTrustFindings(m, [
      { file: 'gone.ts', line: 1, status: 'file-missing' },
    ]);
    expect(finding!.category).toBe('SM-TRUST');
    expect(finding!.severity).toBe('medium');
    expect(finding!.affected_surfaces).toEqual(['s']);
    expect(finding!.title).toContain('claims "proven-in-code"');
    expect(finding!.description).toContain('no longer resolves');
    expect(finding!.description).toContain('at most "unverified"');
  });

  it('flags a surface that claims proof but cites no evidence at all', () => {
    const m = map({ surfaces: [surface({ trust: 'human-confirmed' })] });
    const [finding] = deriveTrustFindings(m, []);
    expect(finding!.category).toBe('SM-TRUST');
    expect(finding!.description).toContain('cites no evidence');
    expect(finding!.description).toContain('at most "inferred"');
  });

  it('flags an overstated transition and attributes it to the owning surface', () => {
    const m = map({
      surfaces: [
        surface({
          transitions: [
            {
              to: 's',
              trigger: 'go',
              trust: 'proven-by-test',
              evidence: { file: 'gone.ts', line: 3 },
            },
          ],
        }),
      ],
    });
    const [finding] = deriveTrustFindings(m, [
      { file: 'gone.ts', line: 3, status: 'file-missing' },
    ]);
    expect(finding!.category).toBe('SM-TRUST');
    expect(finding!.affected_surfaces).toEqual(['s']);
    expect(finding!.title).toContain('transition s → s');
  });

  it('flags an overstated guard with no affected surface', () => {
    const m = map({
      guards: [guard({ trust: 'proven-in-code', evidence: { file: 'gone.ts', line: 2 } })],
    });
    const [finding] = deriveTrustFindings(m, [
      { file: 'gone.ts', line: 2, status: 'line-missing' },
    ]);
    expect(finding!.category).toBe('SM-TRUST');
    expect(finding!.affected_surfaces).toEqual([]);
    expect(finding!.title).toContain('guard "g"');
    expect(finding!.resolution).toContain('docs/site-map/app-map.yaml');
  });

  it('tolerates a map with no guards and surfaces with no transitions', () => {
    expect(deriveTrustFindings(map({ surfaces: [surface({ trust: 'unverified' })] }), [])).toEqual(
      [],
    );
  });
});

describe('stampHonestTrustTiers', () => {
  it('caps an overstated surface claim down to its earned tier and reports the change', () => {
    const m = map({
      surfaces: [surface({ trust: 'human-confirmed', evidence: [{ file: 'gone.ts', line: 1 }] })],
    });
    const result = stampHonestTrustTiers(m, [{ file: 'gone.ts', line: 1, status: 'file-missing' }]);
    expect(result.changed).toBe(true);
    // A broken anchor earns nothing, so the bare-unverified tier is written as the absent default.
    expect(result.map.surfaces[0]!.trust).toBeUndefined();
  });

  it('raises a bare, proven surface to the proven-in-code it earned', () => {
    const m = map({ surfaces: [surface({ evidence: [{ file: 'a.ts', line: 1 }] })] });
    const result = stampHonestTrustTiers(m, [{ file: 'a.ts', line: 1, status: 'resolved' }]);
    expect(result.changed).toBe(true);
    expect(result.map.surfaces[0]!.trust).toBe('proven-in-code');
  });

  it('leaves a stronger attestation standing over a live anchor', () => {
    const m = map({
      surfaces: [surface({ trust: 'human-confirmed', evidence: [{ file: 'a.ts', line: 1 }] })],
    });
    const result = stampHonestTrustTiers(m, [{ file: 'a.ts', line: 1, status: 'resolved' }]);
    expect(result.changed).toBe(false);
    expect(result.map.surfaces[0]!.trust).toBe('human-confirmed');
  });

  it('is a no-op when every earned tier already matches (idempotent)', () => {
    const m = map({
      surfaces: [
        surface({ id: 'proven', trust: 'proven-in-code', evidence: [{ file: 'a.ts', line: 1 }] }),
        surface({ id: 'bare' }),
      ],
      guards: [guard({ trust: 'inferred' })],
    });
    const resolutions = [{ file: 'a.ts', line: 1, status: 'resolved' as const }];
    const once = stampHonestTrustTiers(m, resolutions);
    expect(once.changed).toBe(false);
    // Re-stamping the already-earned map still changes nothing.
    expect(stampHonestTrustTiers(once.map, resolutions).changed).toBe(false);
  });

  it('stamps a proven transition while leaving an unchanged sibling edge untouched', () => {
    const provenEdge = { to: 's', trigger: 'go', evidence: { file: 'a.ts', line: 2 } };
    const steadyEdge = { to: 's', trigger: 'stay', trust: 'inferred' as const };
    const m = map({ surfaces: [surface({ transitions: [provenEdge, steadyEdge] })] });
    const result = stampHonestTrustTiers(m, [{ file: 'a.ts', line: 2, status: 'resolved' }]);
    expect(result.changed).toBe(true);
    const [stampedProven, stampedSteady] = result.map.surfaces[0]!.transitions!;
    expect(stampedProven!.trust).toBe('proven-in-code');
    // The steady edge has no code anchor, so its authored inferred tier survives unchanged.
    expect(stampedSteady!.trust).toBe('inferred');
    expect(stampedSteady).toBe(steadyEdge);
  });

  it('keeps a surface object untouched when none of its edges changed', () => {
    const s = surface({ transitions: [{ to: 's', trigger: 'go', trust: 'inferred' }] });
    const m = map({ surfaces: [s] });
    const result = stampHonestTrustTiers(m, []);
    expect(result.changed).toBe(false);
    expect(result.map.surfaces[0]).toBe(s);
  });

  it('stamps guards and preserves a map that declares no guards', () => {
    const withGuards = map({
      guards: [guard({ trust: 'proven-in-code', evidence: { file: 'gone.ts', line: 9 } })],
    });
    const guardResult = stampHonestTrustTiers(withGuards, [
      { file: 'gone.ts', line: 9, status: 'file-missing' },
    ]);
    expect(guardResult.changed).toBe(true);
    expect(guardResult.map.guards![0]!.trust).toBeUndefined();

    const noGuards = map({ surfaces: [surface()] });
    const noGuardResult = stampHonestTrustTiers(noGuards, []);
    expect(noGuardResult.changed).toBe(false);
    expect(noGuardResult.map.guards).toBeUndefined();
  });
});
