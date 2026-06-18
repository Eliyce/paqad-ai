import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import YAML from 'yaml';

import {
  getProfileConfig,
  ProfileValidationError,
  putProfile,
  setCapability,
} from '@/dashboard/config-profile.js';

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

describe('profile config endpoint logic', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-config-profile-'));
    mkdirSync(join(root, '.paqad'), { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('returns null profile plus schema and capability sets on a bare project', () => {
    const config = getProfileConfig(root);
    expect(config.profile).toBeNull();
    expect(config.schema).toMatchObject({ $id: 'project-profile' });
    expect(config.capabilities.available).toContain('coding');
    expect(config.capabilities.active).toEqual([]);
  });

  it('round-trips a valid profile through the core write path with an audit line', () => {
    const result = putProfile(root, baseProfile());
    expect(result.profile.project.name).toBe('Demo');

    const onDisk = YAML.parse(
      readFileSync(join(root, '.paqad/project-profile.yaml'), 'utf8'),
    ) as Record<string, unknown>;
    expect(onDisk.project).toMatchObject({ name: 'Demo' });
    expect(readFileSync(join(root, '.paqad/audit.log'), 'utf8')).toContain(
      'dashboard.config.profile.write',
    );

    const config = getProfileConfig(root);
    expect(config.profile?.project.name).toBe('Demo');
  });

  it('rejects payloads that fail the schema after canonicalization', () => {
    const bad = { ...baseProfile(), project: { name: 'Demo' } };
    let error: ProfileValidationError | null = null;
    try {
      putProfile(root, bad);
    } catch (err) {
      error = err as ProfileValidationError;
    }
    expect(error).toBeInstanceOf(ProfileValidationError);
    expect(error?.issues.length).toBeGreaterThan(0);
  });

  it('rejects non-object payloads', () => {
    expect(() => putProfile(root, 'nope')).toThrow(ProfileValidationError);
  });

  describe('setCapability', () => {
    it('enables and disables capabilities through the canonical write path', () => {
      writeFileSync(join(root, '.paqad/project-profile.yaml'), YAML.stringify(baseProfile()));

      const enabled = setCapability(root, 'planning', true);
      expect(enabled.active).toContain('planning');

      const disabled = setCapability(root, 'planning', false);
      expect(disabled.active).not.toContain('planning');

      const audit = readFileSync(join(root, '.paqad/audit.log'), 'utf8');
      expect(audit).toContain('dashboard.capabilities.set');
      expect(audit).toContain('capability="planning"');
    });

    it('rejects unknown capabilities', () => {
      writeFileSync(join(root, '.paqad/project-profile.yaml'), YAML.stringify(baseProfile()));
      expect(() => setCapability(root, 'time-travel', true)).toThrow(/Unknown capability/);
    });

    it('fails clearly when no profile exists', () => {
      expect(() => setCapability(root, 'coding', true)).toThrow(/onboard/);
    });
  });
});
