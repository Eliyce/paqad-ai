import dagre from '@dagrejs/dagre';

import type { AppMap, Surface } from './site-map-types';

export interface LaidOutCard {
  id: string;
  surface: Surface;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LaidOutDistrict {
  id: string;
  label: string;
  colorIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
  surfaceCount: number;
  cards: LaidOutCard[];
}

export interface DistrictLayout {
  districts: LaidOutDistrict[];
  width: number;
  height: number;
}

export const UNGROUPED_ID = '__ungrouped__';
export const UNGROUPED_LABEL = 'Ungrouped';

export const PALETTE_SIZE = 12;

const CARD_HEIGHT = 46;
const CARD_GUTTER = 16;
const DISTRICT_PADDING = 24;
const DISTRICT_LABEL_H = 30;
const DISTRICT_GUTTER = 40;
const ASPECT_BIAS = 1.6;

export function cardWidth(label: string): number {
  return Math.max(120, Math.min(260, label.length * 7.2 + 36));
}

export function areaColorIndex(areaId: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < areaId.length; i += 1) {
    hash ^= areaId.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash % PALETTE_SIZE;
}

interface PositionedBlock {
  cards: LaidOutCard[];
  width: number;
  height: number;
}

function components(surfaces: Surface[]): { chains: Surface[][]; loose: Surface[] } {
  const ids = new Set(surfaces.map((s) => s.id));
  const adjacency = new Map<string, Set<string>>();
  for (const surface of surfaces) adjacency.set(surface.id, new Set());
  for (const surface of surfaces) {
    for (const transition of surface.transitions ?? []) {
      if (!ids.has(transition.to) || transition.to === surface.id) continue;
      adjacency.get(surface.id)!.add(transition.to);
      adjacency.get(transition.to)!.add(surface.id);
    }
  }
  const order = new Map(surfaces.map((surface, index) => [surface.id, index]));
  const seen = new Set<string>();
  const chains: Surface[][] = [];
  const loose: Surface[] = [];
  const byId = new Map(surfaces.map((surface) => [surface.id, surface]));
  for (const surface of surfaces) {
    if (seen.has(surface.id)) continue;
    const stack = [surface.id];
    const groupIds: string[] = [];
    seen.add(surface.id);
    while (stack.length > 0) {
      const current = stack.pop()!;
      groupIds.push(current);
      const neighbours = [...adjacency.get(current)!].sort((a, b) => order.get(a)! - order.get(b)!);
      for (const next of neighbours) {
        if (seen.has(next)) continue;
        seen.add(next);
        stack.push(next);
      }
    }
    const group = groupIds.sort((a, b) => order.get(a)! - order.get(b)!).map((id) => byId.get(id)!);
    if (group.length >= 2) {
      chains.push(group);
    } else {
      loose.push(group[0]);
    }
  }
  return { chains, loose };
}

function layoutChain(chain: Surface[]): PositionedBlock {
  const graph = new dagre.graphlib.Graph({ multigraph: true });
  graph.setGraph({ rankdir: 'LR', nodesep: CARD_GUTTER, ranksep: 48, marginx: 0, marginy: 0 });
  const ids = new Set(chain.map((s) => s.id));
  for (const surface of chain) {
    graph.setNode(surface.id, { width: cardWidth(surface.label), height: CARD_HEIGHT });
  }
  for (const surface of chain) {
    (surface.transitions ?? []).forEach((transition, index) => {
      if (!ids.has(transition.to) || transition.to === surface.id) return;
      graph.setEdge(surface.id, transition.to, {}, `${surface.id}->${transition.to}#${index}`);
    });
  }
  dagre.layout(graph);
  const cards: LaidOutCard[] = chain.map((surface) => {
    const laid = graph.node(surface.id) as { x: number; y: number; width: number; height: number };
    return {
      id: surface.id,
      surface,
      x: laid.x - laid.width / 2,
      y: laid.y - laid.height / 2,
      width: laid.width,
      height: laid.height,
    };
  });
  return normalizeBlock(cards);
}

function layoutGrid(loose: Surface[]): PositionedBlock {
  const widths = loose.map((surface) => cardWidth(surface.label));
  const maxWidth = widths.reduce((max, width) => Math.max(max, width), 0);
  const columns = Math.max(1, Math.round(Math.sqrt(loose.length) * ASPECT_BIAS));
  const targetRowWidth = columns * (maxWidth + CARD_GUTTER);
  const cards: LaidOutCard[] = [];
  let cursorX = 0;
  let cursorY = 0;
  let rowMax = 0;
  for (let i = 0; i < loose.length; i += 1) {
    const width = widths[i];
    if (cursorX > 0 && cursorX + width > targetRowWidth) {
      cursorX = 0;
      cursorY += CARD_HEIGHT + CARD_GUTTER;
    }
    cards.push({
      id: loose[i].id,
      surface: loose[i],
      x: cursorX,
      y: cursorY,
      width,
      height: CARD_HEIGHT,
    });
    cursorX += width + CARD_GUTTER;
    rowMax = Math.max(rowMax, cursorX - CARD_GUTTER);
  }
  return { cards, width: rowMax, height: cursorY + CARD_HEIGHT };
}

function normalizeBlock(cards: LaidOutCard[]): PositionedBlock {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = 0;
  let maxY = 0;
  for (const card of cards) {
    minX = Math.min(minX, card.x);
    minY = Math.min(minY, card.y);
    maxX = Math.max(maxX, card.x + card.width);
    maxY = Math.max(maxY, card.y + card.height);
  }
  const shifted = cards.map((card) => ({ ...card, x: card.x - minX, y: card.y - minY }));
  return { cards: shifted, width: maxX - minX, height: maxY - minY };
}

function layoutDistrictInterior(surfaces: Surface[]): {
  cards: LaidOutCard[];
  width: number;
  height: number;
} {
  const { chains, loose } = components(surfaces);
  const blocks: PositionedBlock[] = chains.map(layoutChain);
  if (loose.length > 0) blocks.push(layoutGrid(loose));
  const cards: LaidOutCard[] = [];
  let cursorY = DISTRICT_LABEL_H;
  let maxWidth = 0;
  for (const block of blocks) {
    for (const card of block.cards) {
      cards.push({ ...card, x: DISTRICT_PADDING + card.x, y: cursorY + card.y });
    }
    cursorY += block.height + CARD_GUTTER;
    maxWidth = Math.max(maxWidth, block.width);
  }
  const height = Math.max(cursorY - CARD_GUTTER, DISTRICT_LABEL_H) + DISTRICT_PADDING;
  const width = maxWidth + DISTRICT_PADDING * 2;
  return { cards, width, height };
}

function groupIntoDistricts(map: AppMap): { id: string; label: string; surfaces: Surface[] }[] {
  const declared = new Map((map.areas ?? []).map((area) => [area.id, area.label]));
  const buckets = new Map<string, Surface[]>();
  const seenOrder: string[] = [];
  for (const surface of map.surfaces) {
    const key =
      surface.area !== undefined && declared.has(surface.area) ? surface.area : UNGROUPED_ID;
    if (!buckets.has(key)) {
      buckets.set(key, []);
      seenOrder.push(key);
    }
    buckets.get(key)!.push(surface);
  }
  const districts = seenOrder.map((id) => ({
    id,
    label: id === UNGROUPED_ID ? UNGROUPED_LABEL : declared.get(id)!,
    surfaces: buckets.get(id)!,
  }));
  districts.sort((a, b) => {
    if (b.surfaces.length !== a.surfaces.length) return b.surfaces.length - a.surfaces.length;
    return a.id < b.id ? -1 : 1;
  });
  return districts;
}

export type StoredPositions = Record<string, { x: number; y: number }>;

export function layoutSiteMapDistricts(map: AppMap, stored?: StoredPositions): DistrictLayout {
  const grouped = groupIntoDistricts(map);
  const sized = grouped.map((district) => {
    const interior = layoutDistrictInterior(district.surfaces);
    return {
      id: district.id,
      label: district.label,
      colorIndex: areaColorIndex(district.id),
      surfaceCount: district.surfaces.length,
      cards: interior.cards,
      width: interior.width,
      height: interior.height,
    };
  });

  if (sized.length === 0) {
    return { districts: [], width: 0, height: 0 };
  }

  const pins = stored ?? {};
  const pinned: LaidOutDistrict[] = [];
  const flowing: typeof sized = [];
  for (const district of sized) {
    const pin = pins[district.id];
    if (pin === undefined) {
      flowing.push(district);
    } else {
      pinned.push({ ...district, x: pin.x, y: pin.y });
    }
  }

  let canvasWidth = 0;
  let pinnedBottom = 0;
  for (const district of pinned) {
    canvasWidth = Math.max(canvasWidth, district.x + district.width);
    pinnedBottom = Math.max(pinnedBottom, district.y + district.height);
  }

  const totalArea = flowing.reduce((sum, district) => sum + district.width * district.height, 0);
  const targetRowWidth = Math.max(
    Math.sqrt(totalArea * ASPECT_BIAS),
    flowing.reduce((max, district) => Math.max(max, district.width), 0),
  );

  const districts: LaidOutDistrict[] = [...pinned];
  let cursorX = 0;
  let cursorY = pinned.length > 0 ? pinnedBottom + DISTRICT_GUTTER : 0;
  let rowHeight = 0;
  for (const district of flowing) {
    if (cursorX > 0 && cursorX + district.width > targetRowWidth) {
      cursorX = 0;
      cursorY += rowHeight + DISTRICT_GUTTER;
      rowHeight = 0;
    }
    districts.push({ ...district, x: cursorX, y: cursorY });
    cursorX += district.width + DISTRICT_GUTTER;
    rowHeight = Math.max(rowHeight, district.height);
    canvasWidth = Math.max(canvasWidth, cursorX - DISTRICT_GUTTER);
  }
  const canvasHeight = flowing.length > 0 ? cursorY + rowHeight : pinnedBottom;
  return { districts, width: canvasWidth, height: canvasHeight };
}

export function cardCenter(district: LaidOutDistrict, card: LaidOutCard): { x: number; y: number } {
  return { x: district.x + card.x + card.width / 2, y: district.y + card.y + card.height / 2 };
}
