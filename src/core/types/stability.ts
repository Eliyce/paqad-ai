export const STABILITY_LEVELS = ['stable', 'beta', 'alpha', 'internal'] as const;

export type StabilityLevel = (typeof STABILITY_LEVELS)[number];

export interface SurfaceEntry {
  consumer: string;
  engineModule: string;
  functionSignature: string;
  stabilityLevel: StabilityLevel;
  since: string;
  exempt?: string;
}
