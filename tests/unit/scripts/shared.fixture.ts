import type { ProjectProfile } from '@/core/types/project-profile';

export function scriptProfile(
  stack:
    | 'laravel'
    | 'flutter'
    | 'dotnet'
    | 'nextjs'
    | 'flask'
    | 'nestjs'
    | 'kotlin-android' = 'laravel',
): ProjectProfile {
  return {
    project: { name: 'demo-project', id: 'demo', description: 'Demo' },
    routing: { domain: 'coding', stack, capabilities: [] },
    commands: {
      install: 'echo install',
      dev: 'echo dev',
      test: 'echo test',
      test_single: 'echo test-one',
      lint: 'echo lint',
      format: 'echo format --check',
      migrate: 'echo migrate',
      build: 'echo build',
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
    mcp: { servers: [] },
    model_routing: {
      default_model: 'gpt-5',
      reasoning_model: 'gpt-5',
      fast_model: 'gpt-5-mini',
    },
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
      db_row_threshold: 1000,
    },
    custom: {
      classification_dimensions: [],
      verification_plugins: [],
      escalation_rules: [],
    },
  };
}
