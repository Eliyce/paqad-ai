import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import YAML from 'yaml';

import { PATHS } from '@/core/constants/paths.js';
import {
  buildDecisionPacket,
  computePacketConfidence,
  decisionOptionsForCategory,
  decisionQuestionForCategory,
  selectViableDecisionOptions,
} from '@/planning/index.js';

import { createManifest } from './fixtures.js';

describe('decision packet builder', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'decision-packet-builder-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('builds a packet with evidence, recommendation, confidence, and ttl override', () => {
    mkdirSync(join(root, 'src/planning'), { recursive: true });
    mkdirSync(join(root, '.paqad'), { recursive: true });
    writeFileSync(join(root, 'src/planning/index.ts'), 'export const value = 1;\n', 'utf8');
    writeFileSync(
      join(root, PATHS.PROJECT_PROFILE),
      YAML.stringify({
        project: { name: 'Test', id: 'test', description: 'test' },
        active_capabilities: ['content', 'coding', 'security'],
        stack_profile: {
          frameworks: ['node'],
          traits: [],
          toolchains: [],
          version_bands: [],
          sources: [],
        },
        commands: {
          install: 'pnpm install',
          dev: 'pnpm dev',
          test: 'pnpm test',
          test_single: 'pnpm test',
          lint: 'pnpm lint',
          format: 'pnpm format',
          migrate: 'pnpm migrate',
          build: 'pnpm build',
        },
        strictness: {
          full_lane_default: true,
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
        },
        mcp: { servers: [] },
        model_routing: {
          default_model: 'gpt-5.4',
          reasoning_model: 'gpt-5.4',
          fast_model: 'gpt-5.4-mini',
        },
        research: { depth: 'standard' },
        intelligence: {
          rag_enabled: true,
          rag_similarity_threshold: 0.8,
          rag_top_n: 5,
        },
        efficiency: {},
        escalation: {
          destructive_operations: 'warn',
          risky_migrations: 'warn',
          security_findings: 'warn',
          db_row_threshold: 1000,
        },
        custom: {
          classification_dimensions: [],
          verification_plugins: [],
          escalation_rules: [],
          decisions: {
            ttl_overrides_days: {
              'create-vs-reuse': 10,
            },
          },
        },
      }),
      'utf8',
    );

    const manifest = createManifest({
      execution_slices: [
        {
          ...createManifest().execution_slices[0],
          goal: 'Should we reuse existing code or create new support?',
          touches: ['src/planning/index.ts'],
        },
      ],
    });
    const context = {
      manifest_header: {
        plan_version: manifest.plan_version,
        plan_mode: manifest.plan_mode,
        feature_id: manifest.feature_id,
        slug: manifest.slug,
        created_at: manifest.created_at,
        classification: manifest.classification,
      },
      current_slice: manifest.execution_slices[0]!,
      verification_criteria: [],
      test_skeletons: [],
      doc_targets: [],
      regression_entries: [],
      prior_slices: [],
      existing_code_matches: [],
      decision_context: [],
      token_budget: 5000,
    };

    const packet = buildDecisionPacket({
      projectRoot: root,
      requestedBy: 'codex-cli',
      taskSessionId: manifest.slug,
      decisionId: 'D-2',
      category: 'create-vs-reuse',
      detectorConfidence: 0.92,
      context,
      manifest,
    });

    expect(packet.recommendation).toBe('reuse-existing');
    expect(packet.confidence).toBeGreaterThan(0.85);
    expect(packet.options[0]?.evidence).toMatchObject({
      file: 'src/planning/index.ts',
      callers: 1,
      similarity: 0.91,
    });
    expect(packet.options[1]?.evidence.evidence_partial).toBe(true);
    expect(
      Math.round(
        (Date.parse(packet.ttl_until) - Date.parse(packet.created_at)) / (24 * 60 * 60 * 1000),
      ),
    ).toBe(10);
  });

  it('covers helper branches for questions, options, and confidence scoring', () => {
    expect(decisionQuestionForCategory('workflow-or-tool')).toBe('Which workflow fits best?');
    const options = decisionOptionsForCategory(
      root,
      'workflow-or-tool',
      'src/planning/index.ts',
    ).options;
    expect(options).toHaveLength(2);
    expect(
      computePacketConfidence(
        [
          {
            option_key: 'a',
            label: 'Reuse what exists',
            one_line_preview: 'If you pick this, we will update src/a.ts.',
            trade_off: 'You give up: a blank-slate implementation.',
            evidence: { file: 'src/a.ts', callers: 0, similarity: 0.4 },
          },
          {
            option_key: 'b',
            label: 'Make a new one',
            one_line_preview: 'If you pick this, we will update src/b.ts.',
            trade_off: 'You give up: the shared path that already exists.',
            evidence: { file: 'src/b.ts', callers: 3, similarity: 0.8, rule_match: 'RULE-1' },
          },
        ],
        'b',
        0.64,
      ),
    ).toBe(0.8);
  });

  it('covers all category branches and recommendation-reason branches', () => {
    mkdirSync(join(root, 'src/planning'), { recursive: true });
    writeFileSync(join(root, 'src/planning/index.ts'), 'export const value = 1;\n', 'utf8');
    mkdirSync(join(root, '.paqad'), { recursive: true });
    writeFileSync(
      join(root, PATHS.COMPILED_RULES),
      JSON.stringify({
        rules: [{ rule_id: 'RULE-1', trigger_patterns: ['src/planning/index.ts'] }],
      }),
      'utf8',
    );

    expect(decisionQuestionForCategory('component-reuse')).toBe('Reuse the component or make new?');
    expect(decisionQuestionForCategory('create-vs-reuse')).toBe('Use what exists or make new?');
    expect(decisionQuestionForCategory('shared-abstraction')).toBe('Keep this local or share it?');
    expect(decisionQuestionForCategory('ux-pattern')).toBe('Stay with this pattern?');
    expect(decisionQuestionForCategory('architecture-path')).toBe('Which path should we take?');

    for (const category of [
      'component-reuse',
      'create-vs-reuse',
      'shared-abstraction',
      'ux-pattern',
      'architecture-path',
      'workflow-or-tool',
    ] as const) {
      const built = decisionOptionsForCategory(root, category, 'src/planning/index.ts');
      expect(built.options).toHaveLength(2);
    }

    expect(
      computePacketConfidence(
        [
          {
            option_key: 'a',
            label: 'Reuse what exists',
            one_line_preview: 'If you pick this, we will update src/a.ts.',
            trade_off: 'You give up: a blank-slate implementation.',
            evidence: { file: 'src/a.ts', callers: 0, similarity: 2, rule_match: 'RULE-1' },
          },
        ],
        'a',
        2,
      ),
    ).toBe(0.99);
    expect(
      computePacketConfidence(
        [
          {
            option_key: 'a',
            label: 'Reuse what exists',
            one_line_preview: 'If you pick this, we will update src/a.ts.',
            trade_off: 'You give up: a blank-slate implementation.',
            evidence: { file: 'src/a.ts', callers: 0, similarity: -1 },
          },
        ],
        'missing',
        -1,
      ),
    ).toBe(0);

    const manifest = createManifest({
      execution_slices: [
        {
          ...createManifest().execution_slices[0],
          goal: 'Pick a workflow path',
          touches: ['src/planning/index.ts'],
        },
      ],
    });
    const context = {
      manifest_header: {
        plan_version: manifest.plan_version,
        plan_mode: manifest.plan_mode,
        feature_id: manifest.feature_id,
        slug: manifest.slug,
        created_at: manifest.created_at,
        classification: manifest.classification,
      },
      current_slice: manifest.execution_slices[0]!,
      verification_criteria: [],
      test_skeletons: [],
      doc_targets: [],
      regression_entries: [],
      prior_slices: [],
      existing_code_matches: [],
      decision_context: [],
      token_budget: 5000,
    };
    expect(
      buildDecisionPacket({
        projectRoot: root,
        requestedBy: 'codex-cli',
        taskSessionId: manifest.slug,
        decisionId: 'D-3',
        category: 'workflow-or-tool',
        detectorConfidence: 0.64,
        context,
        manifest,
      }).invalidation_watch,
    ).toEqual(['src/planning/index.ts']);

    expect(
      buildDecisionPacket({
        projectRoot: root,
        requestedBy: 'codex-cli',
        taskSessionId: manifest.slug,
        decisionId: 'D-4',
        category: 'ux-pattern',
        detectorConfidence: 0.64,
        context: {
          ...context,
          current_slice: { ...context.current_slice, touches: ['src/missing.ts'] },
        },
        manifest,
      }).recommendation_reason,
    ).toBe('This is the safer and cheaper path for the first change.');

    expect(
      buildDecisionPacket({
        projectRoot: root,
        requestedBy: 'codex-cli',
        taskSessionId: manifest.slug,
        decisionId: 'D-5',
        category: 'component-reuse',
        detectorConfidence: 0.64,
        context,
        manifest,
      }).invalidation_watch,
    ).toContain(PATHS.DESIGN_SYSTEM_DIR);
    expect(
      buildDecisionPacket({
        projectRoot: root,
        requestedBy: 'codex-cli',
        taskSessionId: manifest.slug,
        decisionId: 'D-6',
        category: 'architecture-path',
        detectorConfidence: 0.64,
        context,
        manifest,
      }).invalidation_watch,
    ).toContain('src/planning/index.ts');

    const noExtensionOptions = decisionOptionsForCategory(root, 'workflow-or-tool', 'src/tool');
    expect(noExtensionOptions.options[1]?.evidence.file).toContain('new-tool');
  });

  it('uses stronger invalidation defaults and filters down to viable options', () => {
    mkdirSync(join(root, 'src/planning'), { recursive: true });
    mkdirSync(join(root, '.paqad'), { recursive: true });
    writeFileSync(join(root, 'src/planning/index.ts'), 'export const value = 1;\n', 'utf8');
    writeFileSync(
      join(root, PATHS.PROJECT_PROFILE),
      YAML.stringify({
        project: { name: 'Test', id: 'test', description: 'test' },
        active_capabilities: ['coding'],
        stack_profile: {
          frameworks: ['node'],
          traits: [],
          toolchains: [],
          version_bands: [],
          sources: [],
        },
        commands: {
          install: 'pnpm install',
          dev: 'pnpm dev',
          test: 'pnpm test',
          test_single: 'pnpm test',
          lint: 'pnpm lint',
          format: 'pnpm format',
          migrate: 'pnpm migrate',
          build: 'pnpm build',
        },
        strictness: {
          full_lane_default: true,
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
        },
        mcp: { servers: [] },
        model_routing: {
          default_model: 'gpt-5.4',
          reasoning_model: 'gpt-5.4',
          fast_model: 'gpt-5.4-mini',
        },
        research: { depth: 'standard' },
        intelligence: {
          rag_enabled: true,
          rag_similarity_threshold: 0.8,
          rag_top_n: 5,
        },
        efficiency: {},
        escalation: {
          destructive_operations: 'warn',
          risky_migrations: 'warn',
          security_findings: 'warn',
          db_row_threshold: 1000,
        },
        custom: {
          classification_dimensions: [],
          verification_plugins: [],
          escalation_rules: [],
          decisions: {
            ask_threshold: 'balanced',
          },
        },
      }),
      'utf8',
    );

    const manifest = createManifest({
      execution_slices: [
        {
          ...createManifest().execution_slices[0],
          slice_id: 'SL-7',
          goal: 'Pick an architecture path',
          touches: ['src/planning/index.ts', 'src/planning/helper.ts'],
        },
      ],
    });
    const context = {
      manifest_header: {
        plan_version: manifest.plan_version,
        plan_mode: manifest.plan_mode,
        feature_id: manifest.feature_id,
        slug: manifest.slug,
        created_at: manifest.created_at,
        classification: manifest.classification,
      },
      current_slice: manifest.execution_slices[0]!,
      verification_criteria: [],
      test_skeletons: [],
      doc_targets: [],
      regression_entries: [],
      prior_slices: [],
      existing_code_matches: [],
      decision_context: [],
      token_budget: 5000,
    };

    const componentPacket = buildDecisionPacket({
      projectRoot: root,
      requestedBy: 'codex-cli',
      taskSessionId: manifest.slug,
      decisionId: 'D-8',
      category: 'component-reuse',
      detectorConfidence: 0.64,
      context,
      manifest,
    });
    expect(componentPacket.invalidation_watch).toEqual(
      expect.arrayContaining([
        'src/planning/index.ts',
        'src/planning/new-index.ts',
        PATHS.DESIGN_SYSTEM_DIR,
      ]),
    );

    const abstractionPacket = buildDecisionPacket({
      projectRoot: root,
      requestedBy: 'codex-cli',
      taskSessionId: manifest.slug,
      decisionId: 'D-10',
      category: 'shared-abstraction',
      detectorConfidence: 0.64,
      context,
      manifest,
    });
    expect(abstractionPacket.invalidation_watch).toEqual(
      expect.arrayContaining([
        'src/planning/index.ts',
        'src/planning/shared-index.ts',
        PATHS.DESIGN_SYSTEM_DIR,
      ]),
    );

    const architecturePacket = buildDecisionPacket({
      projectRoot: root,
      requestedBy: 'codex-cli',
      taskSessionId: manifest.slug,
      decisionId: 'D-9',
      category: 'architecture-path',
      detectorConfidence: 0.64,
      context,
      manifest,
    });
    expect(architecturePacket.invalidation_watch).toEqual(
      expect.arrayContaining(['src/planning/index.ts', 'src/planning/helper.ts']),
    );

    expect(
      selectViableDecisionOptions(root, [
        componentPacket.options[0]!,
        componentPacket.options[1]!,
      ]).map((option) => option.option_key),
    ).toEqual(['reuse-existing']);

    expect(
      selectViableDecisionOptions(root, [
        {
          ...componentPacket.options[0]!,
          evidence: { ...componentPacket.options[0]!.evidence, similarity: 0.2, callers: 0 },
        },
        {
          ...componentPacket.options[1]!,
          evidence: { ...componentPacket.options[1]!.evidence, similarity: 0.3, callers: 0 },
        },
      ]),
    ).toHaveLength(2);
  });
});
