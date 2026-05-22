export const RESOLUTION_LAYERS = [0, 1, 2, 3, 4, 5, 6] as const;
export type ResolutionLayer = (typeof RESOLUTION_LAYERS)[number];

export interface ResolvedArtifact {
  path: string;
  level: ResolutionLayer;
  source: string;
}

export interface ResolvedArtifacts {
  rules: ResolvedArtifact[];
  skills: ResolvedArtifact[];
  agents: ResolvedArtifact[];
  hooks: ResolvedArtifact[];
  templates: ResolvedArtifact[];
  patterns: ResolvedArtifact[];
  antiPatterns: ResolvedArtifact[];
  checklists: ResolvedArtifact[];
  mcpConfigs: ResolvedArtifact[];
}
