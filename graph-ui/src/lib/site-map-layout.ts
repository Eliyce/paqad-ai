// Deterministic, directional layout for the visual site map (issue #466). Surfaces flow left to
// right from their entry points (LAY-1), areas become labelled district frames via dagre's
// compound clustering (AREA-1), and the same map always produces the same arrangement so the
// viewer's spatial memory holds (LAY-2). Pure: given the map, it returns positioned geometry;
// it does no rendering and reads nothing off the DOM.

import dagre from '@dagrejs/dagre';

import type { AppMap, Surface, Transition } from './site-map-types';

export interface LaidOutNode {
  id: string;
  surface: Surface;
  /** Top-left corner (dagre centres nodes; we convert once here). */
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LaidOutEdge {
  id: string;
  from: string;
  to: string;
  transition: Transition;
  points: { x: number; y: number }[];
  /** Where the trigger label sits (the mid point dagre picked). */
  labelX: number;
  labelY: number;
}

export interface LaidOutArea {
  id: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SiteMapLayout {
  nodes: LaidOutNode[];
  edges: LaidOutEdge[];
  areas: LaidOutArea[];
  width: number;
  height: number;
}

const NODE_HEIGHT = 46;
const CLUSTER_PREFIX = 'area::';

/** A readable node width from its label, clamped so long labels never dominate the canvas. */
function nodeWidth(label: string): number {
  return Math.max(120, Math.min(260, label.length * 7.2 + 36));
}

/**
 * Compute the layout. Only transitions whose target is a real surface become edges — a dangling
 * target is dropped from the picture (the map surfaces it as a finding instead of drawing a lie).
 */
export function layoutSiteMap(map: AppMap): SiteMapLayout {
  const surfaces = map.surfaces;
  const known = new Set(surfaces.map((surface) => surface.id));
  const declaredAreas = new Map((map.areas ?? []).map((area) => [area.id, area.label]));

  const graph = new dagre.graphlib.Graph({ compound: true, multigraph: true });
  graph.setGraph({ rankdir: 'LR', nodesep: 28, ranksep: 70, marginx: 24, marginy: 24 });
  graph.setDefaultEdgeLabel(() => ({}));

  // District clusters first, so a surface can be parented into one.
  const usedAreas = new Set<string>();
  for (const surface of surfaces) {
    if (surface.area !== undefined && declaredAreas.has(surface.area)) {
      usedAreas.add(surface.area);
    }
  }
  for (const areaId of usedAreas) {
    graph.setNode(`${CLUSTER_PREFIX}${areaId}`, { label: declaredAreas.get(areaId) });
  }

  for (const surface of surfaces) {
    graph.setNode(surface.id, { width: nodeWidth(surface.label), height: NODE_HEIGHT });
    if (surface.area !== undefined && usedAreas.has(surface.area)) {
      graph.setParent(surface.id, `${CLUSTER_PREFIX}${surface.area}`);
    }
  }

  const edgeInputs: { from: string; to: string; name: string; transition: Transition }[] = [];
  for (const surface of surfaces) {
    (surface.transitions ?? []).forEach((transition, index) => {
      if (!known.has(transition.to)) return;
      const name = `${surface.id}->${transition.to}#${index}`;
      graph.setEdge(surface.id, transition.to, {}, name);
      edgeInputs.push({ from: surface.id, to: transition.to, name, transition });
    });
  }

  dagre.layout(graph);

  const nodes: LaidOutNode[] = surfaces.map((surface) => {
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

  const edges: LaidOutEdge[] = edgeInputs.map((input) => {
    const laid = graph.edge({ v: input.from, w: input.to, name: input.name }) as {
      points: { x: number; y: number }[];
    };
    const points = laid.points;
    const mid = points[Math.floor(points.length / 2)] ?? { x: 0, y: 0 };
    return {
      id: input.name,
      from: input.from,
      to: input.to,
      transition: input.transition,
      points,
      labelX: mid.x,
      labelY: mid.y,
    };
  });

  const areas: LaidOutArea[] = [...usedAreas].map((areaId) => {
    const laid = graph.node(`${CLUSTER_PREFIX}${areaId}`) as {
      x: number;
      y: number;
      width: number;
      height: number;
    };
    return {
      id: areaId,
      label: declaredAreas.get(areaId) ?? areaId,
      x: laid.x - laid.width / 2,
      y: laid.y - laid.height / 2,
      width: laid.width,
      height: laid.height,
    };
  });

  const graphSize = graph.graph() as { width?: number; height?: number };
  return {
    nodes,
    edges,
    areas,
    width: graphSize.width ?? 800,
    height: graphSize.height ?? 600,
  };
}
