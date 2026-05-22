import type { ProjectProfile } from '@/core/types/project-profile';
import type { ResolvedArtifact } from '@/core/types/resolution';

export function fixtureProfile(stack: 'laravel' | 'flutter' = 'laravel'): ProjectProfile {
  return {
    project: { name: 'Demo', id: 'demo', description: 'Demo' },
    routing: { domain: 'coding', stack, capabilities: stack === 'laravel' ? ['boost'] : [] },
    commands: {
      install: 'pnpm install',
      dev: 'pnpm dev',
      test: 'pnpm test',
      test_single: 'pnpm test -- one',
      lint: 'pnpm lint',
      format: 'pnpm format',
      migrate: 'migrate',
      build: 'pnpm build',
    },
    strictness: {
      full_lane_default: false,
      require_adversarial_review: true,
      block_on_stale_docs: true,
      require_db_review_for_migrations: true,
    },
    compliance_packs: [],
    features: {
      spec_only_mode: false,
      market_research: false,
      design_research: false,
      team_agents: true,
      supply_chain_governance: false,
      ai_governance: false,
    },
    mcp: {
      servers:
        stack === 'laravel'
          ? [{ name: 'laravel-boost', enabled: true, config: {} }]
          : [{ name: 'dart-mcp', enabled: true, config: {} }],
    },
    model_routing: { default_model: 'a', reasoning_model: 'b', fast_model: 'c' },
    research: { depth: 'standard' },
    efficiency: {
      context_hit_rate_target: 0.7,
      skill_caching: true,
      differential_refresh: true,
      mcp_first: true,
    },
    escalation: {
      destructive_operations: 'block',
      risky_migrations: 'warn',
      security_findings: 'block',
      db_row_threshold: 10,
    },
    custom: { classification_dimensions: [], verification_plugins: [], escalation_rules: [] },
  };
}

export function fixtureArtifact(name: string): ResolvedArtifact {
  return {
    path: `${process.cwd()}/tests/unit/adapters/fixtures/${name}`,
    level: 1,
    source: name,
  };
}

export function fixtureSkillBundleArtifacts(): ResolvedArtifact[] {
  return [
    fixtureArtifact('sample-skill/SKILL.md'),
    fixtureArtifact('sample-skill/agents/openai.yaml'),
    fixtureArtifact('sample-skill/references/checklist.md'),
  ];
}
