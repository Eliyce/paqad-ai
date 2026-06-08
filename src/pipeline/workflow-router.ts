import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, relative } from 'node:path';

import fg from 'fast-glob';

import { getRuntimeRoot } from '@/core/runtime-paths.js';
import { getPrimaryStack } from '@/core/stack-profile.js';
import {
  CLASSIFICATION_WORKFLOWS,
  type ClassificationWorkflow,
  type WorkflowSource,
} from '@/core/types/classification.js';
import type { ProjectProfile } from '@/core/types/project-profile.js';
import type { ResolvedArtifact } from '@/core/types/resolution.js';
import type { RoutingConfig } from '@/core/types/routing.js';
import type {
  LoadedSkill,
  RuntimeSkillListEntry,
  SkillRequestRoutingRule,
} from '@/core/types/skill.js';
import { readProjectProfile } from '@/core/project-profile.js';
import { Resolver } from '@/resolver/resolver.js';
import { SkillFrontmatterParser, toLoadedSkill } from '@/skills/frontmatter-parser.js';
import type { RuntimeSkillRegistry } from '@/skills/runtime-registry.js';
import { WorkflowTemplateLoader } from '@/workflows/template-loader.js';

export interface WorkflowRouteResult {
  workflow: ClassificationWorkflow | null;
  custom_workflow_name?: string | null;
  workflow_source: WorkflowSource;
  workflow_reason?: string | null;
  matched_rule?: string | null;
}

export interface WorkflowRouterServiceOptions {
  projectRoot?: string;
  runtimeRoot?: string;
  /** Optional registry of runtime-registered skills to merge into routing. */
  runtimeRegistry?: RuntimeSkillRegistry;
}

interface RoutingCandidate {
  skill: LoadedSkill;
  rule: SkillRequestRoutingRule;
  pattern: string;
  specificity: number;
  precedence: number;
}

const PROJECT_SKILL_ROOTS = ['.codex/skills', '.claude/skills', '.gemini/skills', '.junie/skills'];

export class WorkflowRouterService {
  private readonly projectRoot: string;
  private readonly runtimeRoot: string;
  private readonly runtimeRegistry?: RuntimeSkillRegistry;
  private readonly parser = new SkillFrontmatterParser();

  constructor(options: WorkflowRouterServiceOptions = {}) {
    this.projectRoot = options.projectRoot ?? process.cwd();
    this.runtimeRoot = options.runtimeRoot ?? getRuntimeRoot();
    this.runtimeRegistry = options.runtimeRegistry;
  }

  async resolve(
    requestText: string,
    profile?: Pick<ProjectProfile, 'active_capabilities' | 'stack_profile' | 'routing'> | null,
  ): Promise<WorkflowRouteResult> {
    const effectiveProfile = profile ?? readProjectProfile(this.projectRoot);
    // Capture the runtime-skill snapshot once per resolve() so an in-flight call
    // is unaffected by a concurrent register()/remove() (AC3 — snapshot isolation).
    const runtimeSnapshot = this.runtimeRegistry?.snapshot() ?? [];
    const [skills, customWorkflowNames] = await Promise.all([
      this.loadRoutingSkills(effectiveProfile, runtimeSnapshot),
      new WorkflowTemplateLoader(this.projectRoot).list(),
    ]);
    const normalizedRequest = normalizeText(requestText);
    const requestTokens = tokenize(normalizedRequest);
    const candidates: RoutingCandidate[] = [];

    for (const [precedence, skill] of skills.entries()) {
      for (const rule of skill.request_routing ?? []) {
        for (const pattern of rule.patterns) {
          if (!matchesPattern(pattern, normalizedRequest, requestTokens)) {
            continue;
          }

          candidates.push({
            skill,
            rule,
            pattern,
            specificity: normalizeText(pattern).length,
            precedence,
          });
        }
      }
    }

    if (candidates.length === 0) {
      return {
        workflow: null,
        custom_workflow_name: null,
        workflow_source: 'none',
        workflow_reason: 'No workflow routing rule matched the incoming request.',
        matched_rule: null,
      };
    }

    candidates.sort((left, right) => {
      if (left.rule.priority !== right.rule.priority) {
        return right.rule.priority - left.rule.priority;
      }

      if (left.specificity !== right.specificity) {
        return right.specificity - left.specificity;
      }

      return right.precedence - left.precedence;
    });

    const winner = candidates[0];
    const target = winner.rule.target_workflow.trim();
    const customWorkflowName = target.startsWith('custom:') ? target.slice('custom:'.length) : null;

    if (
      !customWorkflowName &&
      !CLASSIFICATION_WORKFLOWS.includes(target as ClassificationWorkflow)
    ) {
      throw new Error(`Workflow routing matched invalid workflow target "${target}"`);
    }

    if (customWorkflowName && !customWorkflowNames.includes(customWorkflowName)) {
      throw new Error(
        `Workflow routing matched custom template "${customWorkflowName}" but it does not exist`,
      );
    }

    return {
      workflow: customWorkflowName ? 'custom' : (target as ClassificationWorkflow),
      custom_workflow_name: customWorkflowName,
      workflow_source: 'routing-skill',
      workflow_reason: `Matched workflow-router rule "${winner.pattern}" from ${winner.skill.name}`,
      matched_rule: winner.pattern,
    };
  }

  private async loadRoutingSkills(
    profile?: Pick<ProjectProfile, 'active_capabilities' | 'stack_profile' | 'routing'> | null,
    runtimeSnapshot: readonly RuntimeSkillListEntry[] = [],
  ): Promise<LoadedSkill[]> {
    const routing = buildRoutingConfig(profile);
    const resolver = new Resolver({ runtimeRoot: this.runtimeRoot });
    const resolved = await resolver.resolve(routing);
    const artifacts = [...resolved.skills, ...(await this.projectSkillArtifacts())];
    const skills: LoadedSkill[] = [];

    for (const artifact of artifacts) {
      const content = await readFile(artifact.path, 'utf8');
      if (!frontmatterHasRequestRouting(content)) {
        continue;
      }

      const parsed = this.parser.parse(content);
      if (!parsed.frontmatter.request_routing?.length) {
        continue;
      }

      skills.push(toLoadedSkill(artifact.path, parsed, profile?.stack_profile?.frameworks ?? []));
    }

    for (const entry of runtimeSnapshot) {
      if (entry.request_routing?.length) {
        skills.push(entry);
      }
    }

    return skills;
  }

  private async projectSkillArtifacts(): Promise<ResolvedArtifact[]> {
    const artifacts: ResolvedArtifact[] = [];

    for (const root of PROJECT_SKILL_ROOTS) {
      const absoluteRoot = join(this.projectRoot, root);
      if (!existsSync(absoluteRoot)) {
        continue;
      }

      const files = await fg('**/SKILL.md', {
        cwd: absoluteRoot,
        absolute: true,
      });

      for (const file of files.sort()) {
        artifacts.push({
          path: file,
          level: 6,
          source: relative(this.projectRoot, file),
        });
      }
    }

    return artifacts;
  }
}

function frontmatterHasRequestRouting(content: string): boolean {
  const lines = content.split(/\r?\n/);

  if (lines[0] !== '---') {
    return false;
  }

  const closingIndex = lines.indexOf('---', 1);
  if (closingIndex === -1) {
    return false;
  }

  for (let i = 1; i < closingIndex; i += 1) {
    if (lines[i].startsWith('request_routing:')) {
      return true;
    }
  }

  return false;
}

function buildRoutingConfig(
  profile?: Pick<ProjectProfile, 'active_capabilities' | 'stack_profile' | 'routing'> | null,
): RoutingConfig {
  if (!profile) {
    return {
      domain: 'content',
      active_capabilities: ['content'],
      stack: 'short-video',
    };
  }

  return {
    domain: profile.active_capabilities?.includes('coding') ? 'coding' : 'content',
    active_capabilities: profile.active_capabilities,
    stack_profile: profile.stack_profile,
    stack: getPrimaryStack(profile as ProjectProfile),
    capabilities: (profile.stack_profile?.traits ?? []) as string[],
  };
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function tokenize(value: string): string[] {
  return value === '' ? [] : value.split(' ');
}

function matchesPattern(
  pattern: string,
  normalizedRequest: string,
  requestTokens: string[],
): boolean {
  const normalizedPattern = normalizeText(pattern);
  if (normalizedPattern === '') {
    return false;
  }

  if (normalizedRequest.includes(normalizedPattern)) {
    return true;
  }

  const patternTokens = tokenize(normalizedPattern);
  if (patternTokens.length === 0 || requestTokens.length < patternTokens.length) {
    return false;
  }

  for (let start = 0; start <= requestTokens.length - patternTokens.length; start += 1) {
    let allMatch = true;
    for (let offset = 0; offset < patternTokens.length; offset += 1) {
      if (!tokensMatch(patternTokens[offset], requestTokens[start + offset])) {
        allMatch = false;
        break;
      }
    }

    if (allMatch) {
      return true;
    }
  }

  return false;
}

function tokensMatch(patternToken: string, requestToken: string): boolean {
  if (patternToken === requestToken) {
    return true;
  }

  if (patternToken.length < 6 || requestToken.length < 6) {
    return false;
  }

  return editDistance(patternToken, requestToken) <= 2;
}

function editDistance(left: string, right: string): number {
  const matrix = Array.from({ length: left.length + 1 }, () =>
    Array.from<number>({ length: right.length + 1 }).fill(0),
  );

  for (let i = 0; i <= left.length; i += 1) {
    matrix[i][0] = i;
  }

  for (let j = 0; j <= right.length; j += 1) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= left.length; i += 1) {
    for (let j = 1; j <= right.length; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost,
      );
    }
  }

  return matrix[left.length][right.length];
}
