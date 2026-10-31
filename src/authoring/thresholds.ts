export const THRESHOLD_TOLERANCE = 1e-9;

export function meetsThreshold(value: number, threshold: number): boolean {
  return value + THRESHOLD_TOLERANCE >= threshold;
}

export function withinLimit(value: number, limit: number): boolean {
  return value - THRESHOLD_TOLERANCE <= limit;
}
