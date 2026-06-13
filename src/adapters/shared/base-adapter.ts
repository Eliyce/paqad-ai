import { readFile } from 'node:fs/promises';
import { basename, join } from 'pathe';

import type { ProjectProfile } from '@/core/types/project-profile.js';
import type { ResolvedArtifact } from '@/core/types/resolution.js';
import { getRuntimeTemplatesRoot } from '@/core/runtime-paths.js';
import { McpConfigManager } from '@/mcp/config-manager.js';
import { TemplateEngine } from '@/templates/engine.js';

import { buildNarrationContractSection } from './narration-contract.js';
import { buildDecisionPauseContractSection } from './provider-entry-contract.js';

import type {
  AdapterCapabilities,
  AdapterContext,
  AdapterInterface,
  GeneratedFile,
} from '../adapter.interface.js';

export abstract class BaseAdapter implements AdapterInterface {
  protected readonly engine = new TemplateEngine();
  readonly capabilities: AdapterCapabilities = {
    skills: true,
    agents: true,
    hooks: true,
    mcp: true,
    caching: true,
    memory: true,
  };

  abstract readonly type: AdapterInterface['type'];

  protected abstract configTemplateName(): string;
  protected abstract configOutputPath(): string;
  protected abstract skillsRoot(): string;
  protected abstract agentsRoot(): string;
  protected abstract hooksOutputPath(): string;
  protected abstract mcpOutputPath(): string;
  protected abstract cacheOutputPath(): string;
  protected abstract memoryOutputPath(): string;

  getConfigPath(): string {
    return this.configOutputPath();
  }

  getMcpPath(): string {
    return this.mcpOutputPath();
  }

  async generateConfig(context: AdapterContext): Promise<GeneratedFile[]> {
    return [
      {
        path: this.configOutputPath(),
        content: await this.engine.render(
          join(getRuntimeTemplatesRoot(), 'agent-configs', this.configTemplateName()),
          {
            adapter: this.type,
            frameworkPath: context.frameworkPath,
            rulesPath: context.rulesPath,
            narrationContract: buildNarrationContractSection(),
            decisionPauseContract: buildDecisionPauseContractSection(this.type),
          },
        ),
        autoUpdate: true,
      },
    ];
  }

  async generateSkills(skills: ResolvedArtifact[]): Promise<GeneratedFile[]> {
    return Promise.all(
      skills.map(async (skill) => ({
        path: join(this.skillsRoot(), getSkillBundleRelativePath(skill)),
        content: await readFile(skill.path, 'utf8'),
        autoUpdate: true,
      })),
    );
  }

  async generateAgents(agents: ResolvedArtifact[]): Promise<GeneratedFile[]> {
    return Promise.all(
      agents.map(async (agent) => ({
        path: join(this.agentsRoot(), basename(agent.path)),
        content: await readFile(agent.path, 'utf8'),
        autoUpdate: true,
      })),
    );
  }

  async installHooks(hooks: ResolvedArtifact[]): Promise<GeneratedFile[]> {
    return [
      {
        path: this.hooksOutputPath(),
        content: JSON.stringify(
          hooks.map((hook) => ({ source: hook.source })),
          null,
          2,
        ),
        autoUpdate: true,
      },
    ];
  }

  async installMcp(
    mcpConfigs: ResolvedArtifact[],
    profile: ProjectProfile,
  ): Promise<GeneratedFile[]> {
    const config = new McpConfigManager().generate(profile, this.type);

    return [
      {
        path: config.path,
        content: JSON.stringify(
          {
            ...JSON.parse(config.content),
            resolved_artifacts: mcpConfigs.map((artifact) => artifact.source),
          },
          null,
          2,
        ),
        autoUpdate: true,
      },
    ];
  }

  async configureCaching(profile: ProjectProfile): Promise<GeneratedFile[]> {
    return [
      {
        path: this.cacheOutputPath(),
        content: JSON.stringify(
          {
            enabled: profile.efficiency.skill_caching,
            differential_refresh: profile.efficiency.differential_refresh,
          },
          null,
          2,
        ),
        autoUpdate: true,
      },
    ];
  }

  async configureMemory(profile: ProjectProfile): Promise<GeneratedFile[]> {
    return [
      {
        path: this.memoryOutputPath(),
        content: JSON.stringify(
          {
            context_hit_rate_target: profile.efficiency.context_hit_rate_target,
            mcp_first: profile.efficiency.mcp_first,
          },
          null,
          2,
        ),
        autoUpdate: true,
      },
    ];
  }
}

function getSkillBundleRelativePath(skill: ResolvedArtifact): string {
  const sourceSegments = skill.source.split(/[\\/]+/);
  const sourceSkillsIndex = sourceSegments.lastIndexOf('skills');

  if (sourceSkillsIndex !== -1 && sourceSkillsIndex < sourceSegments.length - 1) {
    return sourceSegments.slice(sourceSkillsIndex + 1).join('/');
  }

  const segments = skill.path.split(/[\\/]+/);
  const skillsIndex = segments.lastIndexOf('skills');

  if (skillsIndex === -1 || skillsIndex === segments.length - 1) {
    return skill.source.includes('/') ? skill.source : basename(skill.path);
  }

  return segments.slice(skillsIndex + 1).join('/');
}
