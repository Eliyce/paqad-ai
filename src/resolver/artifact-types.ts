export const ARTIFACT_TYPES = [
  'rules',
  'skills',
  'agents',
  'hooks',
  'templates',
  'patterns',
  'anti-patterns',
  'checklists',
  'mcp-configs',
] as const;
export type ArtifactType = (typeof ARTIFACT_TYPES)[number];

export type CollisionBehavior = 'most-specific-wins' | 'additive-merge';

export const COLLISION_MAP: Record<ArtifactType, CollisionBehavior> = {
  rules: 'most-specific-wins',
  skills: 'most-specific-wins',
  agents: 'most-specific-wins',
  hooks: 'most-specific-wins',
  templates: 'most-specific-wins',
  patterns: 'additive-merge',
  'anti-patterns': 'additive-merge',
  checklists: 'additive-merge',
  'mcp-configs': 'additive-merge',
};

export const ARTIFACT_OUTPUT_KEYS = {
  rules: 'rules',
  skills: 'skills',
  agents: 'agents',
  hooks: 'hooks',
  templates: 'templates',
  patterns: 'patterns',
  'anti-patterns': 'antiPatterns',
  checklists: 'checklists',
  'mcp-configs': 'mcpConfigs',
} as const;
