import type { Journey } from './site-map-types';

export const JOURNEY_COLORS = [
  '#2563eb',
  '#dc2626',
  '#16a34a',
  '#d97706',
  '#7c3aed',
  '#0891b2',
  '#db2777',
  '#65a30d',
] as const;

export function journeyColor(index: number): string {
  return JOURNEY_COLORS[index % JOURNEY_COLORS.length];
}

export interface JourneySegment {
  from: string;
  to: string;
}

export function journeySegments(journey: Journey): JourneySegment[] {
  const segments: JourneySegment[] = [];
  for (let i = 0; i < journey.steps.length - 1; i += 1) {
    segments.push({ from: journey.steps[i].surface, to: journey.steps[i + 1].surface });
  }
  return segments;
}

export function stationNumbers(journey: Journey): Map<string, number> {
  const numbers = new Map<string, number>();
  journey.steps.forEach((step, index) => {
    if (!numbers.has(step.surface)) numbers.set(step.surface, index + 1);
  });
  return numbers;
}

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
