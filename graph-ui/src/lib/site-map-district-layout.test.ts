import { describe, expect, it } from 'vitest';

import {
  areaColorIndex,
  cardCenter,
  cardWidth,
  layoutSiteMapDistricts,
  PALETTE_SIZE,
  UNGROUPED_ID,
  UNGROUPED_LABEL,
} from './site-map-district-layout';
import type { AppMap, Surface, Transition } from './site-map-types';

function surface(id: string, area: string | undefined, transitions?: Transition[]): Surface {
  return { id, kind: 'cli-command', label: `Surface ${id}`, area, transitions };
}

/**
 * A deliberately rich map that exercises every branch of the layout: a connected chain (with a
 * self-loop, a dangling target, and a cross-district edge), a pure chain district with no loose
 * cards, two districts tied on surface count, and an area-less surface that falls to Ungrouped.
 */
function richMap(): AppMap {
  return {
    schema_version: 1,
    app: { name: 'test', kind: 'cli' },
    areas: [
      { id: 'a1', label: 'Alpha' },
      { id: 'a2', label: 'Bravo' },
      { id: 'a3', label: 'Charlie' },
    ],
    surfaces: [
      surface('s1', 'a1', [
        { to: 's2', trigger: 'next' },
        { to: 's1', trigger: 'self' }, // self-loop: skipped, not merged
        { to: 'ghost', trigger: 'dangling' }, // unknown target: skipped
      ]),
      surface('s2', 'a1', [{ to: 's3', trigger: 'next' }]),
      surface('s3', 'a1', [{ to: 'x1', trigger: 'cross' }]), // cross-district edge: skipped in-district
      surface('s4', 'a1'),
      surface('s5', 'a1'),
      surface('s6', 'a1'),
      surface('s7', 'a1'),
      surface('s8', 'a1'),
      surface('s9', 'a1'),
      surface('x1', 'a2', [{ to: 'x2', trigger: 'next' }]), // pure chain, no loose cards
      surface('x2', 'a2'),
      surface('y1', 'a3'),
      surface('y2', 'a3'),
      surface('z1', undefined), // area-less → Ungrouped
    ],
  };
}

describe('cardWidth', () => {
  it('clamps to the minimum for short labels', () => {
    expect(cardWidth('x')).toBe(120);
  });

  it('clamps to the maximum for very long labels', () => {
    expect(cardWidth('x'.repeat(80))).toBe(260);
  });

  it('scales with label length in between', () => {
    const width = cardWidth('a moderately sized label');
    expect(width).toBeGreaterThan(120);
    expect(width).toBeLessThan(260);
  });
});

describe('areaColorIndex', () => {
  it('is deterministic and within the palette', () => {
    for (const id of ['a1', 'a2', 'billing', 'onboarding', UNGROUPED_ID]) {
      const index = areaColorIndex(id);
      expect(index).toBe(areaColorIndex(id));
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(PALETTE_SIZE);
    }
  });
});

describe('layoutSiteMapDistricts', () => {
  it('returns an empty layout for a map with no surfaces', () => {
    const layout = layoutSiteMapDistricts({
      schema_version: 1,
      app: { name: 't', kind: 'cli' },
      surfaces: [],
    });
    expect(layout).toEqual({ districts: [], width: 0, height: 0 });
  });

  it('groups surfaces into districts ordered by count then id, area-less to Ungrouped', () => {
    const layout = layoutSiteMapDistricts(richMap());
    expect(layout.districts.map((d) => d.id)).toEqual(['a1', 'a2', 'a3', UNGROUPED_ID]);
    const ungrouped = layout.districts.find((d) => d.id === UNGROUPED_ID);
    expect(ungrouped?.label).toBe(UNGROUPED_LABEL);
    expect(ungrouped?.surfaceCount).toBe(1);
    // a2 and a3 tie on count (2 each); a2 sorts first by id.
    expect(layout.districts[1].id).toBe('a2');
    expect(layout.districts[2].id).toBe('a3');
  });

  it('lays out every surface as a card inside its district', () => {
    const layout = layoutSiteMapDistricts(richMap());
    const total = layout.districts.reduce((sum, d) => sum + d.cards.length, 0);
    expect(total).toBe(14);
    for (const district of layout.districts) {
      for (const card of district.cards) {
        // Cards sit within their district's box (child coordinates, positive, inside width).
        expect(card.x).toBeGreaterThanOrEqual(0);
        expect(card.y).toBeGreaterThanOrEqual(0);
        expect(card.x + card.width).toBeLessThanOrEqual(district.width + 0.001);
      }
    }
  });

  it('never degenerates to a sliver: neither dimension dwarfs the other (D1)', () => {
    const layout = layoutSiteMapDistricts(richMap());
    const ratio = Math.max(layout.width, layout.height) / Math.min(layout.width, layout.height);
    expect(ratio).toBeLessThan(6);
  });

  it('wraps many districts across multiple rows (kills the single column)', () => {
    const areas = Array.from({ length: 12 }, (_, i) => ({ id: `d${i}`, label: `D${i}` }));
    const surfaces = areas.map((a) => surface(`only-${a.id}`, a.id));
    const layout = layoutSiteMapDistricts({
      schema_version: 1,
      app: { name: 't', kind: 'cli' },
      areas,
      surfaces,
    });
    const rows = new Set(layout.districts.map((d) => d.y));
    expect(rows.size).toBeGreaterThan(1);
  });

  it('is deterministic: the same map yields byte-identical geometry (AC-P1-4, LAY-2)', () => {
    const first = layoutSiteMapDistricts(richMap());
    const second = layoutSiteMapDistricts(richMap());
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it('pins a stored district at its saved position and flows the rest below it (Phase 3)', () => {
    const layout = layoutSiteMapDistricts(richMap(), { a1: { x: 1000, y: 2000 } });
    const a1 = layout.districts.find((d) => d.id === 'a1');
    expect(a1).toMatchObject({ x: 1000, y: 2000 });
    // Every unpinned district flows strictly below the pinned one's bottom edge.
    const pinnedBottom = 2000 + (a1?.height ?? 0);
    for (const district of layout.districts) {
      if (district.id !== 'a1') expect(district.y).toBeGreaterThan(pinnedBottom);
    }
  });

  it('handles a fully pinned map (no flowing districts)', () => {
    const layout = layoutSiteMapDistricts(
      {
        schema_version: 1,
        app: { name: 't', kind: 'cli' },
        areas: [{ id: 'solo', label: 'Solo' }],
        surfaces: [surface('only', 'solo')],
      },
      { solo: { x: 40, y: 60 } },
    );
    expect(layout.districts).toHaveLength(1);
    expect(layout.districts[0]).toMatchObject({ id: 'solo', x: 40, y: 60 });
    expect(layout.height).toBe(60 + layout.districts[0].height);
  });
});

describe('cardCenter', () => {
  it('returns the absolute centre of a card within its district', () => {
    const layout = layoutSiteMapDistricts(richMap());
    const district = layout.districts[0];
    const card = district.cards[0];
    expect(cardCenter(district, card)).toEqual({
      x: district.x + card.x + card.width / 2,
      y: district.y + card.y + card.height / 2,
    });
  });
});
