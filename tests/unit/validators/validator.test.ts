import { SchemaValidator } from '@/validators';

describe('SchemaValidator', () => {
  const validator = new SchemaValidator();

  it('valid project profile passes', () => {
    const result = validator.validate('project-profile', validProjectProfile());
    expect(result.valid).toBe(true);
  });

  it('accepts version-enforcement efficiency settings in the project profile schema', () => {
    const profile = validProjectProfile();
    profile.efficiency.skip_version_check = true;
    profile.efficiency.version_check_interval_hours = 12;

    const result = validator.validate('project-profile', profile);
    expect(result.valid).toBe(true);
  });

  it('missing required field fails with specific error', () => {
    const profile = validProjectProfile();
    delete (profile as { commands?: unknown }).commands;

    const result = validator.validate('project-profile', profile);
    expect(result.valid).toBe(false);
    expect(result.errors[0]?.message).toContain('must have required property');
  });

  it('invalid enum value fails with specific error', () => {
    const profile = validProjectProfile();
    profile.active_capabilities = ['content', 'ops' as never];

    const result = validator.validate('project-profile', profile);
    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.message.includes('must be equal'))).toBe(true);
  });

  it('valid detection report passes', () => {
    const result = validator.validate('detection-report', {
      detected_domain: 'coding',
      detected_stack: 'laravel',
      detected_capabilities: ['react'],
      confidence: 'high',
      signals: [{ signal: 'artisan', file: 'artisan', implies: 'laravel', confidence: 'high' }],
      timestamp: new Date().toISOString(),
    });
    expect(result.valid).toBe(true);
  });

  it('valid detection report passes for newly shipped built-in packs', () => {
    const result = validator.validate('detection-report', {
      detected_domain: 'coding',
      detected_stack: 'django',
      detected_capabilities: [],
      matched_packs: ['django'],
      detected_traits: [],
      recommended_capabilities: ['content', 'coding', 'security'],
      confidence: 'high',
      signals: [
        {
          signal: 'django detected',
          file: 'requirements.txt',
          implies: 'django',
          confidence: 'high',
        },
      ],
      timestamp: new Date().toISOString(),
    });
    expect(result.valid).toBe(true);
  });

  it('invalid detection report fails', () => {
    const result = validator.validate('detection-report', { detected_domain: 'coding' });
    expect(result.valid).toBe(false);
  });

  it('valid design tokens pass', () => {
    const result = validator.validate('design-tokens', {
      color: {
        primary: { $value: '#000000', $type: 'color' },
      },
    });
    expect(result.valid).toBe(true);
  });

  it('valid doc progress passes', () => {
    const result = validator.validate('doc-progress', {
      schema_version: '1',
      generated_by: 'paqad-ai',
      framework_version: '0.0.1',
      modules: {
        auth: {
          business: {
            output_path: 'docs/modules/auth/business.md',
            state: 'done',
            started_at: new Date().toISOString(),
            completed_at: new Date().toISOString(),
            source_files: ['app/Http/Controllers/AuthController.php'],
            source_hash: 'sha1:1234567',
            tokens_used: 42,
            error: null,
          },
        },
      },
      global: {},
    });
    expect(result.valid).toBe(true);
  });

  it('valid handoff artifact passes', () => {
    const result = validator.validate('handoff-artifact', {
      framework_version: '0.0.1',
      workflow: 'feature-development',
      current_phase: 'implementation',
      current_story: { id: 'S-1', title: 'Story' },
      completed_stories: [],
      key_decisions: [],
      verification_results: [],
      changed_files: [],
      context_hit_rate: 0.8,
      warnings: [],
      unresolved_items: [],
      closure_summary: {
        code_changed: false,
        test_evidence_changed: false,
        canonical_docs_changed: false,
        blocked: false,
        primary_blocking_reason: null,
        summary:
          'Closure summary: code changed=no; test evidence changed=no; canonical docs changed=no; blocked=no.',
      },
      references: { spec: 'spec.md', flow: 'flow.md', review_report: 'review.md' },
    });
    expect(result.valid).toBe(true);
  });

  it('valid feature development policy passes', () => {
    const result = validator.validate('feature-development-policy', {
      schema_version: '1',
      stages: {
        planning: { read: ['docs/modules/**'] },
        specification: { strictness: { require_spec: true } },
        development: { instructions: ['Stay scoped'] },
        review: { strictness: { require_review: true } },
        checks: {
          checks: {
            use_project_profile_commands: true,
            commands: ['format', 'test', 'build'],
            shell_commands: [],
            block_on_failure: true,
          },
        },
        documentation_sync: { strictness: { require_canonical_sync: true } },
      },
    });

    expect(result.valid).toBe(true);
  });

  it('valid adversarial review report passes', () => {
    const result = validator.validate('adversarial-review-report', {
      point: 'after-spec',
      tier: 'full',
      mode: 'fresh',
      verdict: 'pass',
      summary: 'ok',
      findings: [],
      dimensions_passed_clean: [],
      dimensions_deferred: [],
    });
    expect(result.valid).toBe(true);
  });

  it('error messages are human-readable', () => {
    const result = validator.validate('api-endpoint-doc', {});
    expect(result.errors[0]?.message).toBeTruthy();
    expect(result.errors[0]?.path).toBe('/');
  });
});

function validProjectProfile() {
  return {
    project: { name: 'Test', id: 'test', description: 'desc' },
    active_capabilities: ['content', 'coding', 'security'],
    stack_profile: {
      frameworks: ['laravel'],
      traits: ['react'],
      toolchains: [{ ecosystem: 'php', package_manager: 'composer', lockfile: 'composer.lock' }],
      version_bands: [
        {
          name: 'laravel/framework:^12',
          package_name: 'laravel/framework',
          range: '^12',
          locked_version: '12.0.0',
          source: 'lockfile',
        },
      ],
      sources: [{ file: 'composer.json', kind: 'manifest', detail: 'Detected laravel framework' }],
    },
    commands: {
      install: 'pnpm install',
      dev: 'pnpm dev',
      test: 'pnpm test',
      test_single: 'pnpm test -- one',
      lint: 'pnpm lint',
      format: 'pnpm format',
      migrate: 'php artisan migrate',
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
    mcp: { servers: [] },
    model_routing: {
      default_model: 'gpt-5',
      reasoning_model: 'gpt-5',
      fast_model: 'gpt-5-mini',
    },
    research: { depth: 'standard' },
    intelligence: {
      rag_enabled: false,
      rag_similarity_threshold: 0.75,
      rag_top_n: 20,
      benchmark_gates: {
        hit_at_5_improvement_pct: 20,
        task_success_rate_improvement_pct: 10,
        correction_turn_reduction_pct: 15,
        prompt_token_increase_limit_pct: 10,
        prompt_token_override_success_improvement_pct: 15,
      },
    },
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
      db_row_threshold: 10000,
    },
    custom: {
      classification_dimensions: [],
      verification_plugins: [],
      escalation_rules: [],
    },
  };
}
