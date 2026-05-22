import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import YAML from 'yaml';

import { PATHS } from '@/core/constants/paths.js';
import type { ProjectProfile } from '@/core/types/project-profile.js';
import {
  askThresholdForProject,
  resolveDecisionPacket,
  type DecisionPacket,
} from '@/planning/decision-resolver.js';

describe('decision resolver', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'decision-resolver-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('uses compiled rules before asking', async () => {
    mkdirSync(join(root, '.paqad'), { recursive: true });
    writeFileSync(
      join(root, PATHS.COMPILED_RULES),
      JSON.stringify({
        schema_version: 1,
        generated_at: '2026-04-27T00:00:00Z',
        source_hash: 'sha256:test',
        rules: [
          {
            rule_id: 'RULE-1',
            title: 'Use existing button',
            source_path: 'docs/instructions/rules/button.md',
            trigger_patterns: ['src/components/Button.tsx'],
            severity: 'must',
            summary: 'Use the existing button.',
            raw_text: 'Use the existing button.',
          },
        ],
      }),
    );

    const result = await resolveDecisionPacket(root, makePacket());

    expect(result).toEqual({
      source: 'rule',
      option_key: 'reuse-existing',
      reason: 'Matched compiled rule RULE-1.',
    });
  });

  it('uses design system docs when they clearly prefer reuse', async () => {
    mkdirSync(join(root, PATHS.DESIGN_SYSTEM_DIR), { recursive: true });
    writeFileSync(
      join(root, PATHS.DESIGN_SYSTEM_DIR, 'buttons.md'),
      '# Buttons\nReuse the existing component. Keep one component per app.\n',
      'utf8',
    );

    const result = await resolveDecisionPacket(root, makePacket({ confidence: 0.2 }));

    expect(result.source).toBe('design-system');
    expect(result.option_key).toBe('reuse-existing');
  });

  it('falls back to the packet recommendation when design-system reuse wording exists but no option key matches the reuse prefix', async () => {
    mkdirSync(join(root, PATHS.DESIGN_SYSTEM_DIR), { recursive: true });
    writeFileSync(
      join(root, PATHS.DESIGN_SYSTEM_DIR, 'buttons.md'),
      '# Buttons\nReuse the existing component. Keep one component per app.\n',
      'utf8',
    );

    const result = await resolveDecisionPacket(
      root,
      makePacket({
        options: [
          {
            option_key: 'option-a',
            label: 'Use current workflow',
            one_line_preview: 'If you pick this, we will update src/components/Button.tsx.',
            trade_off: 'You give up: a blank-slate implementation.',
            evidence: { file: 'src/components/Button.tsx', callers: 2, evidence_partial: true },
          },
          {
            option_key: 'option-b',
            label: 'Switch workflow now',
            one_line_preview: 'If you pick this, we will create src/components/new-Button.tsx.',
            trade_off: 'You give up: the shared path that already exists.',
            evidence: { file: 'src/components/new-Button.tsx', callers: 0, evidence_partial: true },
          },
        ],
        recommendation: 'option-b',
        recommendation_reason: 'It is cheaper.',
      }),
    );

    expect(result).toEqual({
      source: 'design-system',
      option_key: 'option-b',
      reason: 'Design system docs prefer the existing pattern.',
    });
  });

  it('falls back to confidence threshold from project profile', async () => {
    writeProfile(root, 'permissive');

    const result = await resolveDecisionPacket(
      root,
      makePacket({
        confidence: 0.8,
        options: [
          {
            option_key: 'reuse-existing',
            label: 'Reuse what exists',
            one_line_preview: 'If you pick this, we will update src/components/Button.tsx.',
            trade_off: 'You give up: a blank-slate implementation.',
            evidence: {
              file: 'src/components/Button.tsx',
              callers: 2,
              similarity: 0.8,
              evidence_partial: true,
            },
          },
          {
            option_key: 'make-new',
            label: 'Make a new one',
            one_line_preview: 'If you pick this, we will create src/components/new-Button.tsx.',
            trade_off: 'You give up: the shared path that already exists.',
            evidence: {
              file: 'src/components/new-Button.tsx',
              callers: 0,
              similarity: 0.4,
              evidence_partial: true,
            },
          },
        ],
      }),
    );

    expect(result).toEqual({
      source: 'rag-confident',
      option_key: 'reuse-existing',
      reason: 'Confidence 0.80 met the project ask threshold.',
    });
    expect(askThresholdForProject(root)).toBe(0.75);
  });

  it('asks when no resolver matches', async () => {
    writeProfile(root, 'strict');

    const result = await resolveDecisionPacket(root, makePacket({ confidence: 0.8 }));

    expect(result).toEqual({ source: 'ask' });
    expect(askThresholdForProject(root)).toBe(0.95);
  });

  it('asks when a compiled rule matches only invalid option paths and the packet has no recommendation', async () => {
    mkdirSync(join(root, '.paqad'), { recursive: true });
    writeFileSync(
      join(root, PATHS.COMPILED_RULES),
      JSON.stringify({
        schema_version: 1,
        generated_at: '2026-04-27T00:00:00Z',
        source_hash: 'sha256:test',
        rules: [
          {
            rule_id: 'RULE-1',
            title: 'Use existing button',
            source_path: 'docs/instructions/rules/button.md',
            trigger_patterns: ['src/components/Elsewhere.tsx'],
            severity: 'must',
            summary: 'Use the existing button.',
            raw_text: 'Use the existing button.',
          },
        ],
      }),
    );

    const result = await resolveDecisionPacket(
      root,
      makePacket({
        recommendation: undefined,
        invalidation_watch: ['src/components/Elsewhere.tsx'],
      }),
    );

    expect(result).toEqual({ source: 'ask' });
  });

  it('uses the balanced threshold by default and asks when recommendation is missing', async () => {
    const result = await resolveDecisionPacket(
      root,
      makePacket({ confidence: 0.9, recommendation: undefined }),
    );

    expect(result).toEqual({ source: 'ask' });
    expect(askThresholdForProject(root)).toBe(0.85);
  });

  it('falls back to packet confidence when no option has similarity data', async () => {
    writeProfile(root, 'permissive');

    const result = await resolveDecisionPacket(
      root,
      makePacket({
        confidence: 0.8,
        options: [
          {
            option_key: 'reuse-existing',
            label: 'Reuse what exists',
            one_line_preview: 'If you pick this, we will update src/components/Button.tsx.',
            trade_off: 'You give up: a blank-slate implementation.',
            evidence: { file: 'src/components/Button.tsx', callers: 2, evidence_partial: true },
          },
          {
            option_key: 'make-new',
            label: 'Make a new one',
            one_line_preview: 'If you pick this, we will create src/components/new-Button.tsx.',
            trade_off: 'You give up: the shared path that already exists.',
            evidence: { file: 'src/components/new-Button.tsx', callers: 0, evidence_partial: true },
          },
        ],
      }),
    );

    expect(result).toEqual({
      source: 'rag-confident',
      option_key: 'reuse-existing',
      reason: 'Confidence 0.80 met the project ask threshold.',
    });
  });

  it('asks when category does not support design-system resolution', async () => {
    mkdirSync(join(root, PATHS.DESIGN_SYSTEM_DIR), { recursive: true });
    writeFileSync(
      join(root, PATHS.DESIGN_SYSTEM_DIR, 'buttons.md'),
      '# Buttons\nReuse the existing component.\n',
      'utf8',
    );

    const result = await resolveDecisionPacket(
      root,
      makePacket({ category: 'workflow-or-tool', confidence: 0.2 }),
    );

    expect(result).toEqual({ source: 'ask' });
  });

  it('asks when the top two candidates are near-tied', async () => {
    const result = await resolveDecisionPacket(
      root,
      makePacket({
        options: [
          {
            option_key: 'reuse-existing',
            label: 'Reuse what exists',
            one_line_preview: 'If you pick this, we will update src/components/Button.tsx.',
            trade_off: 'You give up: a blank-slate implementation.',
            evidence: { file: 'src/components/Button.tsx', callers: 2, similarity: 0.88 },
          },
          {
            option_key: 'make-new',
            label: 'Make a new one',
            one_line_preview: 'If you pick this, we will create src/components/new-Button.tsx.',
            trade_off: 'You give up: the shared path that already exists.',
            evidence: { file: 'src/components/new-Button.tsx', callers: 0, similarity: 0.84 },
          },
        ],
      }),
    );

    expect(result).toEqual({ source: 'ask' });
  });

  it('drops sub-floor candidates and asks when no remaining option clears the threshold', async () => {
    const result = await resolveDecisionPacket(
      root,
      makePacket({
        confidence: 0.2,
        options: [
          {
            option_key: 'reuse-existing',
            label: 'Reuse what exists',
            one_line_preview: 'If you pick this, we will update src/components/Button.tsx.',
            trade_off: 'You give up: a blank-slate implementation.',
            evidence: { file: 'src/components/Button.tsx', callers: 2, similarity: 0.5 },
          },
          {
            option_key: 'make-new',
            label: 'Make a new one',
            one_line_preview: 'If you pick this, we will create src/components/new-Button.tsx.',
            trade_off: 'You give up: the shared path that already exists.',
            evidence: { file: 'src/components/new-Button.tsx', callers: 0, similarity: 0.4 },
          },
        ],
      }),
    );

    expect(result).toEqual({ source: 'ask' });
  });

  it('uses a preferred option from project profile when one is configured', async () => {
    writeProfile(root, 'balanced', { 'create-vs-reuse': 'make-new' });

    const result = await resolveDecisionPacket(root, makePacket({ confidence: 0.2 }));

    expect(result).toEqual({
      source: 'profile',
      option_key: 'make-new',
      reason: 'Project profile prefers make-new.',
    });
  });

  it('tolerates unreadable design-system files and wildcard compiled rules', async () => {
    mkdirSync(join(root, '.paqad'), { recursive: true });
    writeFileSync(
      join(root, PATHS.COMPILED_RULES),
      JSON.stringify({
        schema_version: 1,
        generated_at: '2026-04-27T00:00:00Z',
        source_hash: 'sha256:test',
        rules: [
          {
            rule_id: 'RULE-ALL',
            title: 'Global rule',
            source_path: 'docs/instructions/rules/all.md',
            trigger_patterns: ['**'],
            severity: 'must',
            summary: 'Use the default path.',
            raw_text: 'Use the default path.',
          },
        ],
      }),
    );
    mkdirSync(join(root, PATHS.DESIGN_SYSTEM_DIR), { recursive: true });
    symlinkSync(
      join(root, PATHS.DESIGN_SYSTEM_DIR, 'missing-target.md'),
      join(root, PATHS.DESIGN_SYSTEM_DIR, 'broken.md'),
    );

    const result = await resolveDecisionPacket(root, makePacket());

    expect(result.source).toBe('rule');
  });

  it('asks when no design-system markdown files can be listed and no other resolver matches', async () => {
    mkdirSync(join(root, 'docs/instructions'), { recursive: true });
    writeFileSync(join(root, PATHS.DESIGN_SYSTEM_DIR), 'not a directory', 'utf8');

    const result = await resolveDecisionPacket(root, makePacket({ confidence: 0.2 }));

    expect(result).toEqual({ source: 'ask' });
  });

  it('asks when design-system files exist but do not contain a reuse signal', async () => {
    mkdirSync(join(root, PATHS.DESIGN_SYSTEM_DIR), { recursive: true });
    writeFileSync(
      join(root, PATHS.DESIGN_SYSTEM_DIR, 'buttons.md'),
      '# Buttons\nBrand new pattern only.\n',
      'utf8',
    );

    const result = await resolveDecisionPacket(root, makePacket({ confidence: 0.2 }));

    expect(result).toEqual({ source: 'ask' });
  });

  it('returns a design-system resolution with an undefined option when the packet has no recommendation and no reuse-shaped key', async () => {
    mkdirSync(join(root, PATHS.DESIGN_SYSTEM_DIR), { recursive: true });
    writeFileSync(
      join(root, PATHS.DESIGN_SYSTEM_DIR, 'buttons.md'),
      '# Buttons\nReuse the existing component.\n',
      'utf8',
    );

    const result = await resolveDecisionPacket(
      root,
      makePacket({
        recommendation: undefined,
        options: [
          {
            option_key: 'option-a',
            label: 'Pick option a',
            one_line_preview: 'If you pick this, we will update src/components/Button.tsx.',
            trade_off: 'You give up: a blank-slate implementation.',
            evidence: { file: 'src/components/Button.tsx', callers: 2, evidence_partial: true },
          },
          {
            option_key: 'option-b',
            label: 'Pick option b',
            one_line_preview: 'If you pick this, we will create src/components/new-Button.tsx.',
            trade_off: 'You give up: the shared path that already exists.',
            evidence: { file: 'src/components/new-Button.tsx', callers: 0, evidence_partial: true },
          },
        ],
      }),
    );

    expect(result).toEqual({
      source: 'design-system',
      option_key: undefined,
      reason: 'Design system docs prefer the existing pattern.',
    });
  });
});

function makePacket(overrides: Partial<DecisionPacket> = {}): DecisionPacket {
  return {
    decision_id: 'D-1',
    fingerprint: 'sha256:test',
    category: 'create-vs-reuse',
    question: 'Use what exists or make new?',
    context: 'Choose a path.',
    options: [
      {
        option_key: 'reuse-existing',
        label: 'Reuse what exists',
        one_line_preview: 'If you pick this, we will update src/components/Button.tsx.',
        trade_off: 'You give up: a blank-slate implementation.',
        evidence: { file: 'src/components/Button.tsx', callers: 2, evidence_partial: true },
      },
      {
        option_key: 'make-new',
        label: 'Make a new one',
        one_line_preview: 'If you pick this, we will create src/components/new-Button.tsx.',
        trade_off: 'You give up: the shared path that already exists.',
        evidence: { file: 'src/components/new-Button.tsx', callers: 0, evidence_partial: true },
      },
    ],
    recommendation: 'reuse-existing',
    recommendation_reason: 'It is cheaper.',
    confidence: 0.9,
    requested_by: 'codex-cli',
    task_session_id: 'session-1',
    created_at: '2026-04-27T12:00:00Z',
    status: 'pending',
    ttl_until: '2026-05-27T12:00:00Z',
    invalidation_watch: ['src/components/Button.tsx'],
    ...overrides,
  };
}

function writeProfile(
  root: string,
  askThreshold: NonNullable<ProjectProfile['custom']['decisions']>['ask_threshold'],
  preferred_option_keys?: NonNullable<
    ProjectProfile['custom']['decisions']
  >['preferred_option_keys'],
) {
  const profile: ProjectProfile = {
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
      supply_chain_governance: false,
      ai_governance: false,
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
      decisions: { ask_threshold: askThreshold, preferred_option_keys },
    },
  };

  mkdirSync(join(root, '.paqad'), { recursive: true });
  writeFileSync(join(root, PATHS.PROJECT_PROFILE), YAML.stringify(profile), 'utf8');
}
