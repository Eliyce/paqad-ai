import type { ProjectProfile } from '@/core/types/project-profile.js';
import type { ResolvedArtifact } from '@/core/types/resolution.js';
import type { AdapterType } from '@/core/types/adapter.js';

export interface AdapterCapabilities {
  skills: boolean;
  agents: boolean;
  hooks: boolean;
  mcp: boolean;
  caching: boolean;
  memory: boolean;
}

export interface GeneratedFile {
  path: string;
  content: string;
  autoUpdate: boolean;
  executable?: boolean;
}

export interface AdapterContext {
  frameworkPath: string;
  rulesPath: string;
  projectRoot: string;
}

export interface AdapterInterface {
  readonly type: AdapterType;
  readonly capabilities: AdapterCapabilities;

  getConfigPath(): string;
  getMcpPath(): string;
  generateConfig(context: AdapterContext): Promise<GeneratedFile[]>;
  generateSkills(skills: ResolvedArtifact[]): Promise<GeneratedFile[]>;
  generateAgents(agents: ResolvedArtifact[]): Promise<GeneratedFile[]>;
  installHooks(hooks: ResolvedArtifact[]): Promise<GeneratedFile[]>;
  installMcp(mcpConfigs: ResolvedArtifact[], profile: ProjectProfile): Promise<GeneratedFile[]>;
  configureCaching(profile: ProjectProfile): Promise<GeneratedFile[]>;
  configureMemory(profile: ProjectProfile): Promise<GeneratedFile[]>;
}
