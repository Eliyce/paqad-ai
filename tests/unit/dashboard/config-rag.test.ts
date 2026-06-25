import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import YAML from 'yaml';

import { syncFrameworkConfig } from '@/core/framework-config.js';
import { readProjectProfile } from '@/core/project-profile.js';
import { getRagConfig, putRagConfig, RagValidationError } from '@/dashboard/config-rag.js';

function baseProfile(): Record<string, unknown> {
  return {
    project: { name: 'Demo', id: 'demo', description: 'Demo' },
    active_capabilities: ['content'],
    commands: {
      install: 'pnpm install',
      dev: 'pnpm dev',
      test: 'pnpm test',
      test_single: 'pnpm test -- one',
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
    mcp: { servers: [] },
    model_routing: { default_model: 'gpt-5', reasoning_model: 'gpt-5', fast_model: 'gpt-5-mini' },
    research: { depth: 'standard' },
    efficiency: { skill_caching: true },
    escalation: {
      destructive_operations: 'block',
      risky_migrations: 'warn',
      security_findings: 'block',
      db_row_threshold: 10000,
    },
    custom: { classification_dimensions: [], verification_plugins: [], escalation_rules: [] },
  };
}

describe('rag config endpoint logic', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-config-rag-'));
    mkdirSync(join(root, '.paqad'), { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  describe('getRagConfig', () => {
    it('reports an unknown setup on a bare project', () => {
      const config = getRagConfig(root);
      expect(config.intelligence).toBeNull();
      expect(config.status).toEqual({
        enabled: false,
        provider: null,
        model: null,
        indexPresent: false,
        indexAgeDays: null,
      });
    });

    it('reports profile flags plus index presence and age without any provider call', () => {
      const intelligence = {
        rag_enabled: true,
        embedding_provider: 'openai' as const,
        embedding_model: 'text-embedding-3-small',
        rag_similarity_threshold: 0.75,
        rag_top_n: 20,
      };
      writeFileSync(join(root, '.paqad/project-profile.yaml'), YAML.stringify(baseProfile()));
      // RAG/intelligence is a framework knob: it resolves from `.paqad/.config`
      // (overlaid onto the lean YAML), not the profile YAML, so configure it there.
      syncFrameworkConfig(root, { intelligence });
      mkdirSync(join(root, '.paqad/vectors'), { recursive: true });
      writeFileSync(join(root, '.paqad/vectors/meta.json'), '{}');

      const config = getRagConfig(root);
      expect(config.intelligence?.rag_enabled).toBe(true);
      expect(config.status.enabled).toBe(true);
      expect(config.status.provider).toBe('openai');
      expect(config.status.model).toBe('text-embedding-3-small');
      expect(config.status.indexPresent).toBe(true);
      expect(config.status.indexAgeDays).toBe(0);
    });
  });

  describe('putRagConfig', () => {
    it('applies a partial patch over the normalized intelligence and audits', () => {
      writeFileSync(join(root, '.paqad/project-profile.yaml'), YAML.stringify(baseProfile()));

      const result = putRagConfig(root, {
        rag_enabled: true,
        embedding_provider: 'openai',
        rag_top_n: 10,
      });
      expect(result.intelligence.rag_enabled).toBe(true);
      expect(result.intelligence.embedding_provider).toBe('openai');
      // The provider default fills in when no model is given.
      expect(result.intelligence.embedding_model).toBe('text-embedding-3-small');
      expect(result.intelligence.rag_top_n).toBe(10);
      // Untouched settings keep the normalized defaults.
      expect(result.intelligence.rag_similarity_threshold).toBe(0.75);

      // RAG is a framework knob now: the YAML stays lean (no intelligence
      // section), while the values are persisted to `.paqad/.config` and read
      // back via readProjectProfile's overlay.
      const onDisk = YAML.parse(
        readFileSync(join(root, '.paqad/project-profile.yaml'), 'utf8'),
      ) as Record<string, Record<string, unknown>>;
      expect(onDisk['intelligence']).toBeUndefined();

      const config = readFileSync(join(root, '.paqad/.config'), 'utf8');
      expect(config).toContain('rag_enabled=true');
      expect(config).toContain('rag_top_n=10');

      const reread = readProjectProfile(root);
      expect(reread?.intelligence).toMatchObject({ rag_enabled: true, rag_top_n: 10 });

      const audit = readFileSync(join(root, '.paqad/audit.log'), 'utf8');
      expect(audit).toContain('dashboard.config.rag.write');
      expect(audit).toContain('actor="dashboard"');
    });

    it('accepts every settable key with valid values', () => {
      writeFileSync(join(root, '.paqad/project-profile.yaml'), YAML.stringify(baseProfile()));
      const result = putRagConfig(root, {
        rag_enabled: true,
        embedding_provider: 'voyageai',
        embedding_model: 'voyage-3-large',
        rag_similarity_threshold: 0.5,
        rag_top_n: 5,
        rag_max_file_size: 100000,
      });
      expect(result.intelligence).toMatchObject({
        rag_enabled: true,
        embedding_provider: 'voyageai',
        embedding_model: 'voyage-3-large',
        rag_similarity_threshold: 0.5,
        rag_top_n: 5,
        rag_max_file_size: 100000,
      });
    });

    it('ignores keys passed as undefined', () => {
      writeFileSync(join(root, '.paqad/project-profile.yaml'), YAML.stringify(baseProfile()));
      const result = putRagConfig(root, { rag_enabled: true, embedding_model: undefined });
      expect(result.intelligence.rag_enabled).toBe(true);
    });

    it('rejects non-object payloads', () => {
      expect(() => putRagConfig(root, 'nope')).toThrow(RagValidationError);
    });

    it('rejects unknown keys with per-field issues', () => {
      let error: RagValidationError | null = null;
      try {
        putRagConfig(root, { rag_enabled: true, rebuild: true });
      } catch (err) {
        error = err as RagValidationError;
      }
      expect(error).toBeInstanceOf(RagValidationError);
      expect(error?.issues[0]?.path).toBe('/rebuild');
      expect(error?.issues[0]?.message).toContain('rag_enabled');
    });

    it('rejects out-of-range and mistyped values with per-field issues', () => {
      let error: RagValidationError | null = null;
      try {
        putRagConfig(root, {
          rag_enabled: 'yes',
          embedding_provider: 7,
          embedding_model: 7,
          rag_similarity_threshold: 2,
          rag_top_n: 0,
          rag_max_file_size: 1.5,
        });
      } catch (err) {
        error = err as RagValidationError;
      }
      expect(error).toBeInstanceOf(RagValidationError);
      expect(error?.issues.map((issue) => issue.path)).toEqual([
        '/rag_enabled',
        '/embedding_provider',
        '/embedding_model',
        '/rag_similarity_threshold',
        '/rag_top_n',
        '/rag_max_file_size',
      ]);
    });

    it('rejects providers outside the profile schema enum', () => {
      writeFileSync(join(root, '.paqad/project-profile.yaml'), YAML.stringify(baseProfile()));
      let error: RagValidationError | null = null;
      try {
        putRagConfig(root, { embedding_provider: 'azure' });
      } catch (err) {
        error = err as RagValidationError;
      }
      expect(error).toBeInstanceOf(RagValidationError);
      expect(error?.issues.length).toBeGreaterThan(0);
    });

    it('fails clearly when no profile exists', () => {
      expect(() => putRagConfig(root, { rag_enabled: true })).toThrow(/onboard/);
    });
  });
});
