// Small pure derivations over the served site map, shared by the canvas, the fog/insight overlays
// (Phase 3), and the gaps chip (issue #489). All read only the payload already present — no LLM at
// view time (NFR-1). Kept in one place so the dead-surface rule has a single definition.

import type { AppMap, Journey } from './site-map-types';

/** Surfaces that are dead: no entry, no inbound edge, and no outbound edge (DEAD-1, dimmed). */
export function deadSurfaceIds(map: AppMap): Set<string> {
  const hasInbound = new Set<string>();
  const hasOutbound = new Set<string>();
  const known = new Set(map.surfaces.map((surface) => surface.id));
  for (const surface of map.surfaces) {
    for (const transition of surface.transitions ?? []) {
      if (!known.has(transition.to)) continue;
      hasOutbound.add(surface.id);
      hasInbound.add(transition.to);
    }
  }
  const dead = new Set<string>();
  for (const surface of map.surfaces) {
    const rooted = surface.entry !== undefined;
    if (!rooted && !hasInbound.has(surface.id) && !hasOutbound.has(surface.id)) {
      dead.add(surface.id);
    }
  }
  return dead;
}

/** The surface ids a journey visits, in order (its own steps carry the sequence; no edges needed). */
export function journeySurfaceIds(journey: Journey | null): Set<string> {
  const ids = new Set<string>();
  if (journey === null) return ids;
  for (const step of journey.steps) ids.add(step.surface);
  return ids;
}

/** Transition targets that name a surface the map does not contain (a dangling reference). */
export function danglingTargets(map: AppMap): { from: string; to: string }[] {
  const known = new Set(map.surfaces.map((surface) => surface.id));
  const dangling: { from: string; to: string }[] = [];
  for (const surface of map.surfaces) {
    for (const transition of surface.transitions ?? []) {
      if (!known.has(transition.to)) dangling.push({ from: surface.id, to: transition.to });
    }
  }
  return dangling;
}

/** Journey steps that reference a surface the map does not contain (a broken journey reference). */
export function brokenJourneyRefs(
  map: AppMap,
  journeys: Journey[],
): { journey: string; surface: string }[] {
  const known = new Set(map.surfaces.map((surface) => surface.id));
  const broken: { journey: string; surface: string }[] = [];
  for (const journey of journeys) {
    for (const step of journey.steps) {
      if (!known.has(step.surface)) broken.push({ journey: journey.id, surface: step.surface });
    }
  }
  return broken;
}
