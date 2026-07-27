import { describe, expect, it } from 'vitest';

import type { AppMap, Surface } from '@/core/types/site-map.js';
import {
  collectMapEvidence,
  collectVerificationFindings,
  type EvidenceResolution,
} from '@/site-map/verification.js';

function surface(overrides: Partial<Surface> = {}): Surface {
  return { id: 's', kind: 'page', label: 'S', ...overrides };
}

function map(overrides: Partial<AppMap> = {}): AppMap {
  return { schema_version: 1, app: { name: 'x', kind: 'cli' }, surfaces: [], ...overrides };
}

/** Every candidate category from a verification run, sorted for stable assertions. */
function categories(m: AppMap, resolutions: EvidenceResolution[] = []): string[] {
  return collectVerificationFindings(m, resolutions)
    .candidates.map((finding) => finding.category)
    .sort();
}

describe('collectMapEvidence', () => {
  it('returns nothing when there is no map', () => {
    expect(collectMapEvidence(null)).toEqual([]);
  });

  it('collects and de-duplicates pointers from surfaces, transitions, and guards', () => {
    const m = map({
      guards: [{ id: 'g', kind: 'role', label: 'G', evidence: { file: 'guard.ts', line: 1 } }],
      surfaces: [
        surface({
          evidence: [
            { file: 'a.ts', line: 1 },
            { file: 'a.ts', line: 1 }, // duplicate of the first
          ],
          transitions: [{ to: 's', trigger: 'x', evidence: { file: 'edge.ts', line: 2 } }],
        }),
      ],
    });
    const pointers = collectMapEvidence(m);
    expect(pointers).toEqual([
      { file: 'a.ts', line: 1 },
      { file: 'edge.ts', line: 2 },
      { file: 'guard.ts', line: 1 },
    ]);
  });

  it('tolerates surfaces with no evidence and no transitions', () => {
    expect(collectMapEvidence(map({ surfaces: [surface()] }))).toEqual([]);
  });
});

describe('collectVerificationFindings — no map', () => {
  it('verifies nothing when the map is absent', () => {
    expect(collectVerificationFindings(null, [])).toEqual({ candidates: [], blockedChecks: [] });
  });
});

describe('SM-REMOVE and SM-EVIDENCE', () => {
  it('reads a surface whose every cited file is gone as removed', () => {
    const m = map({
      surfaces: [surface({ evidence: [{ file: 'gone.ts', line: 3 }] })],
    });
    const [finding] = collectVerificationFindings(m, [
      { file: 'gone.ts', line: 3, status: 'file-missing' },
    ]).candidates;
    expect(finding!.category).toBe('SM-REMOVE');
    expect(finding!.severity).toBe('high');
    expect(finding!.affected_surfaces).toEqual(['s']);
    expect(finding!.affected_files).toEqual(['gone.ts']);
    expect(finding!.evidence[0]).toContain('file not found');
  });

  it('flags a partially-broken surface as stale evidence, not a removal', () => {
    const m = map({
      surfaces: [
        surface({
          evidence: [
            { file: 'here.ts', line: 1 },
            { file: 'gone.ts', line: 9 },
          ],
        }),
      ],
    });
    const [finding] = collectVerificationFindings(m, [
      { file: 'here.ts', line: 1, status: 'resolved' },
      { file: 'gone.ts', line: 9, status: 'file-missing' },
    ]).candidates;
    expect(finding!.category).toBe('SM-EVIDENCE');
    expect(finding!.affected_files).toEqual(['gone.ts']);
  });

  it('does not read an all-broken surface as removed when a line simply moved', () => {
    const m = map({ surfaces: [surface({ evidence: [{ file: 'moved.ts', line: 99 }] })] });
    const [finding] = collectVerificationFindings(m, [
      { file: 'moved.ts', line: 99, status: 'line-missing' },
    ]).candidates;
    expect(finding!.category).toBe('SM-EVIDENCE');
    expect(finding!.evidence[0]).toContain('line out of range');
  });

  it('treats an unresolved (absent) pointer as resolved, so it raises nothing', () => {
    const m = map({ surfaces: [surface({ evidence: [{ file: 'a.ts', line: 1 }] })] });
    expect(collectVerificationFindings(m, []).candidates).toEqual([]);
  });

  it('ignores a surface that cites no evidence', () => {
    expect(collectVerificationFindings(map({ surfaces: [surface()] }), []).candidates).toEqual([]);
  });

  it('reports broken guard evidence with no affected surface', () => {
    const m = map({
      guards: [
        { id: 'g-admin', kind: 'role', label: 'Admin', evidence: { file: 'mw.ts', line: 5 } },
      ],
    });
    const [finding] = collectVerificationFindings(m, [
      { file: 'mw.ts', line: 5, status: 'file-missing' },
    ]).candidates;
    expect(finding!.category).toBe('SM-EVIDENCE');
    expect(finding!.affected_surfaces).toEqual([]);
    expect(finding!.title).toContain('guard "g-admin"');
  });

  it('handles a broken pointer that cites a file with no line number', () => {
    const m = map({
      guards: [{ id: 'g', kind: 'role', label: 'G', evidence: { file: 'noline.ts' } }],
    });
    const [finding] = collectVerificationFindings(m, [
      { file: 'noline.ts', line: undefined, status: 'file-missing' },
    ]).candidates;
    expect(finding!.category).toBe('SM-EVIDENCE');
    // The proof drops the `:line` suffix when the pointer has no line.
    expect(finding!.evidence[0]).toContain('cites noline.ts — file not found');
  });

  it('leaves resolved guard evidence alone', () => {
    const m = map({
      guards: [{ id: 'g', kind: 'role', label: 'G', evidence: { file: 'ok.ts', line: 1 } }],
    });
    expect(
      collectVerificationFindings(m, [{ file: 'ok.ts', line: 1, status: 'resolved' }]).candidates,
    ).toEqual([]);
  });

  it('attributes broken transition evidence to its owning surface', () => {
    const m = map({
      surfaces: [
        surface({
          transitions: [{ to: 's', trigger: 'x', evidence: { file: 'edge.ts', line: 4 } }],
        }),
      ],
    });
    const [finding] = collectVerificationFindings(m, [
      { file: 'edge.ts', line: 4, status: 'line-missing' },
    ]).candidates;
    expect(finding!.category).toBe('SM-EVIDENCE');
    expect(finding!.affected_surfaces).toEqual(['s']);
    expect(finding!.title).toContain('transition s → s');
  });
});

describe('SM-XREF — dangling references', () => {
  it('flags a transition to a surface that does not exist', () => {
    const m = map({
      surfaces: [surface({ transitions: [{ to: 's-missing', trigger: 'go' }] })],
    });
    const [finding] = collectVerificationFindings(m, []).candidates;
    expect(finding!.category).toBe('SM-XREF');
    expect(finding!.title).toContain('s → s-missing');
    expect(finding!.affected_surfaces).toEqual(['s']);
  });

  it('flags an undefined guard referenced by a surface (guard and guard_not)', () => {
    const m = map({
      surfaces: [surface({ guard: 'g-x', guard_not: 'g-y' })],
    });
    const found = collectVerificationFindings(m, []).candidates;
    expect(found.every((finding) => finding.category === 'SM-XREF')).toBe(true);
    expect(found.map((finding) => finding.title).join(' ')).toContain('g-x');
    expect(found.map((finding) => finding.title).join(' ')).toContain('g-y');
  });

  it('flags undefined guards referenced by a transition, an area, and an actor', () => {
    const m = map({
      actors: [{ id: 'a', label: 'A', satisfies: ['g-actor'] }],
      areas: [{ id: 'ar', label: 'Ar', guard: 'g-area' }],
      surfaces: [
        surface({
          transitions: [{ to: 's', trigger: 'go', guard: 'g-edge', guard_not: 'g-edge2' }],
        }),
      ],
    });
    const titles = collectVerificationFindings(m, []).candidates.map((finding) => finding.title);
    expect(titles.join(' ')).toContain('g-edge');
    expect(titles.join(' ')).toContain('g-edge2');
    expect(titles.join(' ')).toContain('g-area');
    expect(titles.join(' ')).toContain('g-actor');
  });

  it('accepts references that resolve (guard list, existing target)', () => {
    const m = map({
      guards: [
        { id: 'g1', kind: 'role', label: 'G1' },
        { id: 'g2', kind: 'role', label: 'G2' },
      ],
      surfaces: [
        surface({ id: 's-a', guard: ['g1', 'g2'], transitions: [{ to: 's-b', trigger: 'go' }] }),
        surface({ id: 's-b', entry: { kind: 'url' } }),
      ],
    });
    expect(categories(m)).not.toContain('SM-XREF');
  });
});

describe('graph invariants — SM-ORPHAN and SM-DEADEND', () => {
  it('flags a surface unreachable from any entry, and clears a reachable one', () => {
    const m = map({
      surfaces: [
        surface({ id: 's-a', entry: { kind: 'url' }, transitions: [{ to: 's-b', trigger: 'go' }] }),
        surface({ id: 's-b', ends: { success: true } }),
        surface({ id: 's-c', ends: { success: true } }), // no path in
      ],
    });
    const orphans = collectVerificationFindings(m, []).candidates.filter(
      (finding) => finding.category === 'SM-ORPHAN',
    );
    expect(orphans.map((finding) => finding.affected_surfaces[0])).toEqual(['s-c']);
  });

  it('follows a cycle without looping and ignores transitions to unknown surfaces', () => {
    const m = map({
      surfaces: [
        surface({
          id: 's-a',
          entry: { kind: 'url' },
          transitions: [
            { to: 's-b', trigger: 'go' },
            { to: 's-ghost', trigger: 'nowhere' }, // filtered by reachability (still an XREF)
          ],
        }),
        surface({ id: 's-b', transitions: [{ to: 's-a', trigger: 'back' }] }), // cycle back to s-a
      ],
    });
    expect(categories(m)).not.toContain('SM-ORPHAN');
  });

  it('records reachability as blocked when a graph has transitions but no entry root', () => {
    const m = map({
      surfaces: [
        surface({ id: 's-a', transitions: [{ to: 's-b', trigger: 'go' }] }),
        surface({ id: 's-b', ends: { success: true } }),
      ],
    });
    const result = collectVerificationFindings(m, []);
    expect(result.blockedChecks.map((check) => check.check)).toEqual(['reachability']);
    expect(result.candidates.some((finding) => finding.category === 'SM-ORPHAN')).toBe(false);
  });

  it('skips reachability and dead-ends entirely when the map models no transitions', () => {
    const m = map({ surfaces: [surface({ id: 's-a' }), surface({ id: 's-b' })] });
    const result = collectVerificationFindings(m, []);
    expect(result.blockedChecks).toEqual([]);
    expect(result.candidates).toEqual([]);
  });

  it('flags a navigational dead-end (no exit, ends absent or all-falsy)', () => {
    const m = map({
      surfaces: [
        surface({
          id: 's-a',
          entry: { kind: 'url' },
          transitions: [{ to: 's-a', trigger: 'self' }],
        }),
        surface({ id: 's-dead' }), // page, no transitions, no ends
        surface({ id: 's-dead2', ends: { success: false } }), // ends present but all falsy
      ],
    });
    const deadends = collectVerificationFindings(m, [])
      .candidates.filter((finding) => finding.category === 'SM-DEADEND')
      .map((finding) => finding.affected_surfaces[0])
      .sort();
    expect(deadends).toEqual(['s-dead', 's-dead2']);
  });

  it('does not call a non-navigational or terminal-marked surface a dead-end', () => {
    const m = map({
      surfaces: [
        surface({
          id: 's-a',
          entry: { kind: 'url' },
          transitions: [{ to: 's-a', trigger: 'self' }],
        }),
        surface({ id: 's-api', kind: 'api' }), // exempt kind
        surface({ id: 's-ok', ends: { failure: true } }), // terminal via failure
        surface({ id: 's-ok2', ends: { abandoned: 'left' } }), // terminal via abandoned
      ],
    });
    expect(categories(m)).not.toContain('SM-DEADEND');
  });
});

describe('SM-GUARDLESS — sensitive surfaces', () => {
  it('flags an unguarded backstage surface', () => {
    const m = map({ surfaces: [surface({ visibility: 'backstage' })] });
    const [finding] = collectVerificationFindings(m, []).candidates;
    expect(finding!.category).toBe('SM-GUARDLESS');
    expect(finding!.severity).toBe('high');
  });

  it('clears a backstage surface guarded on the surface', () => {
    const m = map({
      guards: [{ id: 'g', kind: 'role', label: 'G' }],
      surfaces: [surface({ visibility: 'backstage', guard: 'g' })],
    });
    expect(categories(m)).not.toContain('SM-GUARDLESS');
  });

  it('clears a backstage surface guarded through its area', () => {
    const m = map({
      guards: [{ id: 'g', kind: 'role', label: 'G' }],
      areas: [{ id: 'admin', label: 'Admin', guard: 'g' }],
      surfaces: [surface({ visibility: 'backstage', area: 'admin' })],
    });
    expect(categories(m)).not.toContain('SM-GUARDLESS');
  });

  it('inherits backstage sensitivity from the surface area when the surface is silent', () => {
    const m = map({
      areas: [{ id: 'admin', label: 'Admin', visibility: 'backstage' }],
      surfaces: [surface({ area: 'admin' })],
    });
    expect(categories(m)).toContain('SM-GUARDLESS');
  });

  it('leaves a frontstage surface and an area-less surface alone', () => {
    const m = map({
      surfaces: [surface({ id: 's-front', visibility: 'frontstage' }), surface({ id: 's-none' })],
    });
    expect(categories(m)).not.toContain('SM-GUARDLESS');
  });

  it('treats a surface pointing at an unknown area as not sensitive', () => {
    const m = map({ surfaces: [surface({ area: 'ghost-area' })] });
    expect(categories(m)).not.toContain('SM-GUARDLESS');
  });
});
