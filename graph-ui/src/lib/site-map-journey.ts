// Journey → metro-line data (issue #489, Phase 2). Journeys carry their own ordered steps, so the
// subway lines exist even when the map has zero transitions (fixes D6). These are pure derivations
// over the served journeys — no LLM, no layout maths here (the canvas owns geometry).

import type { Journey } from './site-map-types';

/** A fixed, colour-blind-considerate line palette; a journey's colour is stable by its index. */
export const JOURNEY_COLORS = [
  '#2563eb', // blue
  '#dc2626', // red
  '#16a34a', // green
  '#d97706', // amber
  '#7c3aed', // violet
  '#0891b2', // cyan
  '#db2777', // pink
  '#65a30d', // lime
] as const;

export function journeyColor(index: number): string {
  return JOURNEY_COLORS[index % JOURNEY_COLORS.length];
}

/** One consecutive station-to-station segment of a journey line. */
export interface JourneySegment {
  from: string;
  to: string;
}

/** The ordered station segments of a journey (empty when it has fewer than two steps). */
export function journeySegments(journey: Journey): JourneySegment[] {
  const segments: JourneySegment[] = [];
  for (let i = 0; i < journey.steps.length - 1; i += 1) {
    segments.push({ from: journey.steps[i].surface, to: journey.steps[i + 1].surface });
  }
  return segments;
}

/** For a journey, the 1-based station number of each surface it visits (first occurrence wins). */
export function stationNumbers(journey: Journey): Map<string, number> {
  const numbers = new Map<string, number>();
  journey.steps.forEach((step, index) => {
    if (!numbers.has(step.surface)) numbers.set(step.surface, index + 1);
  });
  return numbers;
}

/** Surfaces visited by two or more journeys — the interchange stations (double-ring). */
export function interchangeSurfaces(journeys: Journey[]): Set<string> {
  const seenIn = new Map<string, number>();
  for (const journey of journeys) {
    const unique = new Set(journey.steps.map((step) => step.surface));
    for (const surface of unique) seenIn.set(surface, (seenIn.get(surface) ?? 0) + 1);
  }
  const interchange = new Set<string>();
  for (const [surface, count] of seenIn) {
    if (count >= 2) interchange.add(surface);
  }
  return interchange;
}
