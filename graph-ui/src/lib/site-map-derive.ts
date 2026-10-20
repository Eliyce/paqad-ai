import type { AppMap, Journey } from './site-map-types';

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

export function journeySurfaceIds(journey: Journey | null): Set<string> {
  const ids = new Set<string>();
  if (journey === null) return ids;
  for (const step of journey.steps) ids.add(step.surface);
  return ids;
}

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
