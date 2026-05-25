import { DEFAULT_CONVENTIONS, resolveConventions } from '@/core/conventions.js';
import { SchemaValidator } from '@/validators/validator.js';

describe('conventions resolver', () => {
  it('returns framework defaults when nothing is set', () => {
    const resolved = resolveConventions(undefined);
    expect(resolved).toEqual(DEFAULT_CONVENTIONS);
  });

  it('shallow-merges project overrides over the per-section defaults', () => {
    const resolved = resolveConventions({
      branch: { base: 'develop' },
      pr: { draft: true, reviewers: ['alice'] },
    });
    expect(resolved.branch.base).toBe('develop');
    expect(resolved.branch.template).toBe(DEFAULT_CONVENTIONS.branch.template);
    expect(resolved.pr.draft).toBe(true);
    expect(resolved.pr.reviewers).toEqual(['alice']);
    expect(resolved.pr.base).toBe(DEFAULT_CONVENTIONS.pr.base);
  });

  it('supports flipping write_back / require_ticket from their defaults', () => {
    const resolved = resolveConventions({
      ticket: { require_ticket: true, write_back: 'never' },
    });
    expect(resolved.ticket.require_ticket).toBe(true);
    expect(resolved.ticket.write_back).toBe('never');
    expect(resolved.ticket.provider).toBe('jira');
  });
});

describe('project-profile schema validation for conventions and MCP kind', () => {
  function makeProfile(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      project: { name: 'demo', id: 'demo', description: 'demo' },
      active_capabilities: ['content'],
      commands: {
        install: 'pnpm install',
        dev: 'pnpm dev',
        test: 'pnpm test',
        test_single: 'pnpm test one',
        lint: 'pnpm lint',
        format: 'pnpm format',
        migrate: 'pnpm migrate',
        build: 'pnpm build',
      },
      strictness: {
        full_lane_default: false,
        require_adversarial_review: false,
        block_on_stale_docs: false,
        require_db_review_for_migrations: false,
      },
      compliance_packs: [],
      features: {
        spec_only_mode: false,
        market_research: false,
        design_research: false,
        team_agents: false,
        supply_chain_governance: false,
        ai_governance: false,
      },
      mcp: { servers: [] },
      model_routing: { default_model: 'm', reasoning_model: 'm', fast_model: 'm' },
      research: { depth: 'standard' },
      intelligence: { rag_enabled: false, rag_similarity_threshold: 0.5, rag_top_n: 5 },
      efficiency: {},
      escalation: {
        destructive_operations: 'block',
        risky_migrations: 'warn',
        security_findings: 'block',
        db_row_threshold: 100,
      },
      custom: {
        classification_dimensions: [],
        verification_plugins: [],
        escalation_rules: [],
      },
      ...overrides,
    };
  }

  it('accepts a profile with no conventions block (backwards-compatible)', () => {
    const validator = new SchemaValidator();
    const result = validator.validate('project-profile', makeProfile());
    expect(result.valid).toBe(true);
  });

  it('accepts a profile with a partial conventions block', () => {
    const validator = new SchemaValidator();
    const result = validator.validate(
      'project-profile',
      makeProfile({
        conventions: {
          ticket: { provider: 'linear', write_back: 'never' },
          pr: { base: 'develop', draft: true },
        },
      }),
    );
    expect(result.valid).toBe(true);
  });

  it('rejects unknown keys in the conventions block', () => {
    const validator = new SchemaValidator();
    const result = validator.validate(
      'project-profile',
      makeProfile({ conventions: { ticket: { mystery: true } } }),
    );
    expect(result.valid).toBe(false);
  });

  it('accepts an MCP server with kind: jira', () => {
    const validator = new SchemaValidator();
    const result = validator.validate(
      'project-profile',
      makeProfile({
        mcp: {
          servers: [{ name: 'jira-team', enabled: true, kind: 'jira', config: {} }],
        },
      }),
    );
    expect(result.valid).toBe(true);
  });

  it('still accepts an MCP server without kind (no migration required)', () => {
    const validator = new SchemaValidator();
    const result = validator.validate(
      'project-profile',
      makeProfile({
        mcp: { servers: [{ name: 'legacy', enabled: true }] },
      }),
    );
    expect(result.valid).toBe(true);
  });

  it('rejects an MCP server with an unknown kind', () => {
    const validator = new SchemaValidator();
    const result = validator.validate(
      'project-profile',
      makeProfile({
        mcp: { servers: [{ name: 's', enabled: true, kind: 'asana' }] },
      }),
    );
    expect(result.valid).toBe(false);
  });
});
