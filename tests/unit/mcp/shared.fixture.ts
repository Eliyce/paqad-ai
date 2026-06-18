import type { ProjectProfile } from '@/core/types/project-profile.js';

export function fixtureProfile(
  stack: ProjectProfile['routing']['stack'] = 'laravel',
  capabilities?: ProjectProfile['routing']['capabilities'],
): ProjectProfile {
  return {
    project: {
      name: 'Demo',
      id: 'demo',
      description: 'Fixture profile',
    },
    routing: {
      domain: stack === 'short-video' ? 'content' : 'coding',
      stack,
      capabilities: capabilities ?? (stack === 'laravel' ? ['boost'] : []),
    },
    commands: {
      install: 'pnpm install',
      dev: 'pnpm dev',
      test: 'pnpm test',
      test_single: 'pnpm test --',
      lint: 'pnpm lint',
      format: 'pnpm format',
      migrate: 'pnpm migrate',
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
    },
    mcp: {
      servers:
        stack === 'laravel'
          ? [{ name: 'figma', enabled: false, config: {} }]
          : [{ name: 'figma', enabled: false, config: {} }],
    },
    model_routing: {
      default_model: 'gpt-5',
      reasoning_model: 'gpt-5',
      fast_model: 'gpt-5-mini',
    },
    research: {
      depth: 'standard',
    },
    efficiency: {
      context_hit_rate_target: 0.8,
      skill_caching: true,
      differential_refresh: true,
      mcp_first: true,
    },
    escalation: {
      destructive_operations: 'block',
      risky_migrations: 'require_approval',
      security_findings: 'warn',
      db_row_threshold: 1000,
    },
    custom: {
      classification_dimensions: [],
      verification_plugins: [],
      escalation_rules: [],
    },
  };
}
